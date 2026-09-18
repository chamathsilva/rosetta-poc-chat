# Architecture Notes — Streaming Chat (Phase 2 design)

Scope: concrete implementation architecture **inside** the fixed boundary of `docs/REQUIREMENTS.md` /
`docs/ARCHITECTURE.md`. Layering, SSE-not-WebSockets, `node:sqlite`-not-ORM, Zod-first contracts are
already settled and not revisited here. Five open decision points only.

Governing IDs referenced, never restated: FR-001..FR-011, AC-001..AC-026.

---

## TLDR

**Crux (stream coordination).** Use an in-process **`ResponseStreamHub`: per-response channel +
per-subscriber cursor + subscribe-then-drain**. The append path is the only writer: it commits the
event, then republishes *the persisted row itself*. An SSE subscriber first buffers live publishes,
then drains persisted events `> cursor` from SQLite until the query is exhausted, then flushes the
buffer filtered by `event_id > lastSent`, then runs live. Live and replay therefore emit
byte-identical payloads from one log, the subscribe/replay race window is closed, and channels keyed
by `responseId` make cross-response leakage structurally impossible. Rejected: poll-only (latency +
wall-clock coupling in tests) and direct producer→writer push (two divergent code paths, the
attach-after-replay race is exactly the AC-011 bug).

The other four, one line each:

1. **Schema/ordering** — per-conversation `messages.seq` and per-response `stream_events.event_id`
   as `MAX(...)+1` allocated inside the write transaction; composite PK `(response_id, event_id)`;
   partial unique indexes enforce one-start / one-terminal / one-retry; a single global `counters`
   row drives `conversations.updated_seq`. `ORDER BY` never mentions a timestamp (AC-007).
2. **Idempotency/atomicity** — one ~20-line `withTransaction(db, () => T)` helper over
   `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` with `SAVEPOINT` nesting; the callback is typed
   **synchronous** so no `await` can interleave. `clientMessageId` uniqueness and "one retry per
   failed response" are DB constraints, not application discipline.
3. **Provider** — reply text is a pure function of the normalized prompt; chunked into fixed windows
   of N **Unicode code points** (`Array.from`), so concatenation is byte-identical and no surrogate
   pair is ever split (AC-003). Delayed / disconnecting / failing variants are decorators over the
   same injected interface, wired at the composition root.
4. **Frontend** — one reducer per conversation holding
   `{status, text, lastAppliedEventId}` per response; `event.id <= lastAppliedEventId` → drop
   (idempotent), `event.id > last + 1` → gap → `reconnecting`; conversation id lives in the URL
   query string; live regions announce **state transitions, not deltas**.

Two items for `docs/ASSUMPTIONS.md` are flagged inline: **[A1]** interrupted-response reconciliation
and **[A2]** the `lastEventId` query-param channel. Both are interpretations, not requirements.

---

## Decision 2 (crux) — stream coordination and replay

**Problem.** One event log must serve (a) a live in-process subscriber attached while the provider is
still producing and (b) a reconnecting replay-only client, with persist-before-emit (FR-004), no
duplication and no gaps (FR-005, AC-011), no cross-response leakage, and correct behaviour across
refresh (FR-007, AC-013) and restart (AC-014).

**The actual hazard** is not concurrency — `node:sqlite` is synchronous and this is single-process
(explicit non-goal: multi-process coordination). It is the **yield window**: an SSE handler `await`s
on socket backpressure, so events appended between "replay query returned" and "live subscription
active" are lost if you subscribe last, and duplicated if you subscribe first.

### Alternative A — broadcast hub, per-subscriber cursor, subscribe-then-drain (recommended)

`ResponseStreamHub` holds a channel per `responseId`. `appendEvent()` commits the row, then calls
`hub.publish(responseId, persistedRow)`. Subscriber lifecycle:

1. resolve + validate `responseId` and the cursor → 404/400 before any bytes are written;
2. `attach(responseId)` → live publishes accumulate in a bounded buffer, nothing is written yet;
3. drain loop: `SELECT ... WHERE response_id=? AND event_id>? ORDER BY event_id` in pages until a
   page comes back empty, writing each row and advancing `lastSent`;
4. flush the buffer, dropping `event_id <= lastSent`;
5. steady state: write live publishes as they arrive;
6. on a terminal event: write it, unsubscribe, close the response. Channel is disposed when the last
   subscriber leaves *and* the response is terminal.

- **Pros.** Single writer path; dedupe is a monotonic-integer comparison, provably correct. Replay
  and live are the *same* code path — the only difference is whether a producer is still running, so
  a cold reconnect to a completed response needs no channel at all. Republishing the persisted row
  (rather than the in-flight chunk) makes persist-before-emit a type-level fact and guarantees live
  and replayed bytes are identical, which is what AC-011's "without duplicate text" really demands.
  Channels keyed by `responseId` mean there is no shared bus to leak across responses. Handles the
  two-overlapping-connections case a mid-stream refresh genuinely produces.
- **Cons.** Two mechanisms (DB read + memory buffer) in one handler. Needs a bounded-buffer /
  slow-consumer policy: on overflow, drop the buffer and re-enter the drain loop (always safe — the
  log is authoritative). Hub is process-local.

### Alternative B — poll the log only, no in-memory fanout

Handler loops: query `> cursor`, write, close on terminal, else sleep and repeat. Producer only
persists.

- **Pros.** Simplest possible; one source of truth; replay and live are literally identical; the
  lost/duplicate window cannot exist; restart-correct for free.
- **Cons.** Latency floor equals the poll interval, or CPU burn. Worse, the interval is a wall-clock
  dependency injected straight into delta-ordering tests, which cuts against the determinism the
  whole study rests on. Making it deterministic means adding a notify-or-timeout waker — i.e.
  re-deriving A with extra steps.

### Alternative C — producer pushes directly to the attached writer; reconnects replay from the log

- **Pros.** Lowest latency, least machinery on the happy path.
- **Cons.** Two divergent code paths for live vs. replay means two places to get ordering and
  duplication wrong, and the attach-after-replay seam is precisely the defect FR-005/AC-011 exist to
  catch. Assumes one writer per response; a refresh mid-stream breaks that. Backpressure and
  partial-write handling leak into the provider loop.

### Recommendation: A

Additional committed details:

- **Cursor sources and precedence.** `EventSource` cannot set request headers, so the *initial*
  connect after a refresh must pass the cursor as `?lastEventId=N`; the browser supplies
  `Last-Event-ID` only on its own automatic reconnects. Rule: **header wins when both are present**
  (browser-managed reconnect is authoritative), else the query param, else 0. **[A2]** — the query
  param is an addition to the FR-005 header contract, not a substitute for it.
- **Cursor validation.** `/^\d+$/`, ≤ 2^31-1. Malformed, negative, or non-integer → 400
  `stream_cursor_invalid`. Greater than the response's current max `event_id` → 400
  `stream_cursor_out_of_range` (the client claims events that were never emitted). Missing → 0, full
  replay. These are the four AC-012 cases, each with its own stable code.
- **Contract on `GET /api/conversations/:conversationId`.** It must return the active response's
  `lastEventId` next to its `partialText`, so a refreshing client seeds an exact cursor instead of
  guessing. Without this, AC-013 is unachievable — partial text alone cannot tell you which event
  produced it.
- **Heartbeat.** Periodic `: ping` comment lines carry no `id:`, so they cannot perturb any cursor.
- **Interrupted responses (AC-014).** On startup, `reconcileInterruptedResponses()` finds responses
  that are non-terminal with no terminal event and appends a persisted terminal `response.failed`
  with code `stream_interrupted`, retaining `partial_text`. This keeps "exactly one terminal event"
  true, keeps the replay path uniform, and routes recovery through the existing single-retry
  affordance rather than inventing a fifth response state. **[A1]** — AC-014 fixes the observable
  ("recoverable rather than silently completed"), not the mechanism; this is the chosen reading.

---

## Decision 1 — SQLite schema and deterministic ordering

Pragmas at open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`, `synchronous=FULL` (durability
is what makes persist-before-emit meaningful). Schema applied by one idempotent `applySchema()` of
`CREATE TABLE IF NOT EXISTS` inside a single transaction, plus a `schema_meta(version)` row.

- `conversations(id PK, title, created_at, updated_at, updated_seq NOT NULL)`
  — list ordering is `ORDER BY updated_seq DESC` **only**. `updated_seq` comes from
  `UPDATE counters SET value = value + 1 WHERE name='global_seq' RETURNING value`, bumped inside the
  same transaction as any mutation that touches the conversation.
- `messages(id PK, conversation_id FK, seq NOT NULL, role CHECK(user|assistant), content,
  content_hash, client_message_id NULL, response_id NULL, created_at, UNIQUE(conversation_id, seq))`
  — thread ordering is `ORDER BY seq ASC` **only**; `seq = COALESCE(MAX(seq),0)+1` per conversation,
  allocated in the write transaction, with the UNIQUE making any allocation bug loud instead of
  silent. Partial `UNIQUE(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL`.
- `responses(id PK, conversation_id FK, user_message_id FK, assistant_message_id NULL FK,
  status CHECK(pending|streaming|completed|failed), attempt, retry_of_response_id NULL FK,
  failure_code NULL, partial_text NOT NULL DEFAULT '', created_at, updated_at)`
  — partial `UNIQUE(retry_of_response_id) WHERE retry_of_response_id IS NOT NULL`; partial index on
  `(conversation_id) WHERE status IN ('pending','streaming')` for the active-response lookup.
- `stream_events(response_id FK, event_id INTEGER, type CHECK(4 values), data TEXT, created_at,
  PRIMARY KEY(response_id, event_id))`
  — the composite PK is simultaneously the AC-010 uniqueness invariant and the replay index for
  `WHERE response_id=? AND event_id>? ORDER BY event_id`. Partial unique indexes on `(response_id)`
  filtered to `type='response.started'` and to the two terminal types make "exactly one start,
  exactly one terminal" database-enforced.

**Event-id allocation:** `SELECT COALESCE(MAX(event_id),0)+1 FROM stream_events WHERE response_id=?`
inside the append transaction. Deliberately **not** a denormalized `next_event_seq` column on
`responses` — one source of truth cannot drift from the log, restart-correctness is automatic, and at
POC volume the read costs nothing.

**IDs and clock:** injected `IdGenerator` and `Clock` ports (`crypto.randomUUID` / `Date.now` in
production, counters in tests). Branded Zod id schemas with a charset permissive enough for
`msg_0001`-style test ids and strict enough to validate at every boundary.

*Rationale:* every `ORDER BY` in the product reads an integer sequence, never a timestamp, so AC-007
holds by construction; and the three invariants most likely to be broken by a subtle bug (one start,
one terminal, one retry) are enforced by the storage engine rather than by review.

---

## Decision 3 — idempotency and atomicity on `node:sqlite`

`node:sqlite` is a fully **synchronous** API (`DatabaseSync` / `StatementSync`), which is the whole
answer to "no ORM transaction abstraction":

```
withTransaction(db, fn: () => T): T   // BEGIN IMMEDIATE → fn() → COMMIT; on throw → ROLLBACK
                                      // nested: SAVEPOINT sp_<depth> / RELEASE / ROLLBACK TO
```

The callback type is a plain sync function, not `() => Promise<T>`. That makes "never `await` inside a
transaction" a compile-time property instead of a convention, and it is the only reason atomicity is
trustworthy here.

**Send** (`POST /api/conversations/:conversationId/messages`), one transaction:
lookup by `(conversation_id, client_message_id)` → same `content_hash` ⇒ return the original
`{userMessageId, responseId}`, no insert, no provider run (AC-008); different hash ⇒ throw conflict,
roll back, 409 `client_message_id_conflict`, zero stored change (AC-009); absent ⇒ insert message
(`seq = MAX+1`) + response (`pending`) + the `response.started` event + conversation `updated_seq`
bump, commit (AC-006). The provider run is kicked **after** commit; the route returns 202.

Appending `response.started` in that same transaction means the SSE endpoint is replayable the
instant 202 is returned — no window in which a client connects and finds an empty log.

**Retry** (`POST /api/responses/:responseId/retry`), one transaction: response must exist and be
`failed`, else 409 `response_not_retryable`; if a row already has
`retry_of_response_id = :responseId`, return **that** id. "The same replacement response" is
concretely *the unique row whose `retry_of_response_id` is the failed response* — the partial unique
index guarantees at most one exists ever, so a duplicate insert raises a constraint error the handler
converts into a re-read of the existing child. Idempotent by construction, not by check-then-act. The
replacement reuses `user_message_id`, so AC-017's no-duplicate-user-message property is structural.

**Assistant message materialization:** inserted only in the same transaction as `response.completed`
(with `seq = MAX+1` and the `response_id` link). A failed attempt leaves its text in
`responses.partial_text` and never creates a `messages` row, so a failure cannot pollute the thread
and a retry yields exactly one assistant message (FR-008).

*Rationale:* the sync-typed transaction helper is the minimum viable abstraction over the built-in
module, and pushing both idempotency keys into unique indexes converts two race-prone application
checks into database facts.

---

## Decision 4 — deterministic mock provider

```
interface ChatProvider { generate(input: ProviderInput): AsyncIterable<ProviderChunk> }
ProviderInput  = { normalizedPrompt: string; conversationId: ...; responseId: ... }
ProviderChunk  = { text: string }
```

Reply text is a pure total function of `normalizedPrompt` (fixed template + echo), with no network,
credentials, clock, or randomness. **Chunking:** `Array.from(reply)` to get code points, then fixed
windows of N code points. Code-point windows — not byte slices, not `String.prototype.length` (UTF-16
units) — guarantee no surrogate pair is split, so every delta is independently valid UTF-8 and the
concatenation of deltas is byte-identical to the completed text on every run (AC-003).

Normalization (`trim`, NFC, non-empty, ≤ 4000 code points counted via `Array.from(...).length`) lives
in `packages/shared` so client and server agree. The code-point count is what makes AC-019's
4000/4001 cases correct for astral characters.

Test variants are **decorators over the same interface**, composed at the composition root
(`createServer({ provider, clock, ids, scheduler })`): `delayedProvider(base, scheduler)`,
`disconnectingProvider(base, afterNChunks)` (stops iterating with no terminal event — feeds the
AC-014 path), `failingProvider(base, afterNChunks, failureCode)`. Delay goes through an injected
`Scheduler` port rather than `setTimeout`, keeping tests deterministic without fake timers. No env
vars, no prompt sniffing — FR-003 prohibits both explicitly.

*Rationale:* determinism comes from purity plus a Unicode-safe chunk rule; testability comes from the
composition root, which is the only place variants can be injected without a production backdoor.

---

## Decision 5 — frontend state and reconnection

**URL.** `?conversation=<id>`, read/written via `history.pushState` + a `popstate` listener in a small
`useUrlConversationId()` hook. Query param rather than a path segment so Vite dev needs no
history-fallback config, and hand-rolled rather than a router because a new runtime dependency is a
boundary change.

**State.** One `useReducer` per conversation view; actions are a discriminated union mirroring the
shared SSE schemas, so every applied event is Zod-parsed at the boundary first. Per response:

```
{ responseId, status: 'pending'|'streaming'|'completed'|'failed'|'reconnecting'|'retrying',
  text: string, lastAppliedEventId: number, failure?: { code, message } }
```

**Idempotent application** (FR-007): `event.id <= lastAppliedEventId` → drop unchanged;
`event.id === lastAppliedEventId + 1` → apply (deltas append to `text`) and advance;
`event.id > lastAppliedEventId + 1` → **gap**, so do not apply: set `reconnecting` and reconnect from
`lastAppliedEventId`. Dedupe and gap detection both fall out of the monotonic id, which is why the
single cursor per response is sufficient for merging replay with live.

**Stream hook.** `useResponseStream(responseId)` owns exactly one `EventSource` on
`/api/responses/:id/events?lastEventId=N`. The effect is keyed on `responseId` **only**; the cursor is
read from a ref, otherwise every applied delta would tear down and rebuild the connection.
`onerror` → `reconnecting` and let `EventSource` retry with its own `Last-Event-ID`; a terminal event
or a 4xx → close deliberately and surface a distinguishable state (AC-018). Because every received
event is applied synchronously in the reducer, the browser's `Last-Event-ID` and our
`lastAppliedEventId` never diverge.

**Refresh** (AC-013): mount → conversation id from URL → `GET /api/conversations/:id` → messages plus
`activeResponse { id, status, partialText, lastEventId }` → seed the reducer cursor from
`lastEventId` → connect with that cursor. No delta re-applied, none skipped.

**Accessibility** (AC-022, AC-018, AC-020): `role="status" aria-live="polite"` for
sending/streaming/completed/reconnecting/retrying; `role="alert"` for failed, with focus moved to the
retry `<button>`; `aria-busy` on the streaming text region. The live region announces **state
transitions only, never delta text** — announcing deltas floods a screen reader and makes the status
useless. Composer is a labelled `<textarea>` (Enter sends, Shift+Enter newline); conversation list is
keyboard-navigable native controls. All text renders as text: no `dangerouslySetInnerHTML`, no
markdown.

*Rationale:* a single integer cursor per response is the minimum state that makes replay and live
application interchangeable, and the URL-as-source-of-truth plus exact-cursor seeding is what turns
refresh-during-stream from a special case into the ordinary reconnect path.
