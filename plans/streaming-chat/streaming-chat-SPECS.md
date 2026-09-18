# Tech Specs — Streaming Chat (Phase 3, LARGE)

**The WHAT.** Concrete contracts, DDL, route shapes, SSE payloads, file layout, traceability.
Companion: `plans/streaming-chat/streaming-chat-PLAN.md` (the HOW — sequenced milestones).

## Authority chain — read these first, they are not restated here

| Source | Role |
| --- | --- |
| `docs/REQUIREMENTS.md` | FR-001..FR-011 + fixed technology boundary. Authoritative. |
| `docs/ACCEPTANCE-CRITERIA.md` | AC-001..AC-026. Authoritative, fixed before the run. |
| `docs/ARCHITECTURE.md` | Layering, workspace graph, testing strategy, `npm run check` gate. Authoritative. |
| `plans/streaming-chat/architecture-notes.md` | Phase 2 design, human-approved. Decisions 1–5. **Binding — operationalized here, never redesigned.** |
| `docs/ASSUMPTIONS.md` | `[A1]` interrupted-response reconciliation, `[A2]` `?lastEventId` channel. |
| `docs/EXPERIMENT-BOUNDARY.md` | GOV-004 protocol. |

Conflict rule (`docs/ASSUMPTIONS.md` → "Rosetta-generated docs are subordinate"): seed docs win; this file is the defect.
This file adds no requirement and no acceptance criterion. Where it decides something the sources left open, the
decision is marked **[spec-decision]** with its reason.

## S0 — Conventions

- S0.1 Relative imports in `apps/api` and `packages/shared` carry the `.js` extension (`NodeNext` + `verbatimModuleSyntax`). `apps/web` uses `Bundler` resolution — extensionless relative imports.
- S0.2 `import type { ... }` for type-only imports everywhere (`verbatimModuleSyntax`).
- S0.3 `any` is prohibited in product code (`docs/ARCHITECTURE.md` → Boundaries and safety). `unknown` + Zod parse at every boundary instead. Casts only via schema output types.
- S0.4 Types derive from schemas: `export type X = z.infer<typeof XSchema>`. No hand-written duplicate interfaces for contract data.
- S0.5 Tests are co-located `*.test.ts` / `*.test.tsx` next to the unit under test. Vitest `include` already matches these (`vitest.config.ts`).
- S0.6 `apps/api` and `packages/shared` emit `dist/` via `tsc -p`; co-located test files and `src/testing/**` therefore appear in `dist/`. Accepted — `dist/` is gitignored and never shipped. **[spec-decision]** — alternative (per-member `tsconfig.test.json`) adds four config files and a second tsc invocation for zero product benefit.
- S0.7 No new runtime dependency. Adding one is a technology-boundary change (`docs/ARCHITECTURE.md` → Fixed technology boundary), not an implementation detail.
- S0.8 ISO timestamps are `new Date(ms).toISOString()` from the injected `Clock`. Timestamps are display/audit data only — **never** an `ORDER BY` key (AC-007).
- S0.9 File naming: `camelCase.ts` for modules, `PascalCase.tsx` for React components, `*Repo.ts` for persistence gateways.

## S1 — File layout (concrete paths)

Files marked `(seed)` exist and are rewritten; all others are new.

### S1.1 `packages/shared/src/` — contracts only, no I/O, no Node built-ins (imported by the browser bundle)

```
index.ts            (seed) barrel; re-exports every symbol below. Sole public entry (package exports = ./dist/index.js)
ids.ts                     branded id schemas + IdCharset            → S2.1
content.ts                 normalization, code-point counting        → S2.2
domain.ts                  Conversation/Message/Response/ActiveResponse schemas → S2.3
errors.ts                  error envelope, ErrorCode, FailureCode, message maps → S2.4
api.ts                     request/response body schemas per route   → S2.5
events.ts                  SSE event envelope + 4 payload schemas    → S2.6
cursor.ts                  event-cursor schema + parse result        → S2.6.4
constants.ts               MAX_CONTENT_CODE_POINTS, MAX_EVENT_ID, SCHEMA_VERSION, SSE_* → S2.7
ids.test.ts  content.test.ts  errors.test.ts  api.test.ts  events.test.ts  cursor.test.ts
```

### S1.2 `apps/api/src/` — service

```
index.ts            (seed) entry: loadConfig → openDatabase → createServer → listen → signal handlers   → S6.7
config/env.ts              Zod env schema + loadConfig(env)                                             → S9.1
composition/createServer.ts  createServer(deps) → Fastify instance. Only place variants can be injected → S6.1
composition/ports.ts       Clock | IdGenerator | Scheduler port types                                   → S5.1
composition/clock.ts       systemClock (Date.now)
composition/ids.ts         uuidIdGenerator (crypto.randomUUID, prefixed)
composition/scheduler.ts   timerScheduler (setTimeout-backed)
persistence/db.ts          openDatabase(path) w/ pragmas, closeDatabase                                 → S3.1
persistence/schema.ts      SCHEMA_SQL + applySchema(db)                                                  → S3.2
persistence/transaction.ts withTransaction(db, fn: () => T): T                                          → S3.4
persistence/hash.ts        contentHash(normalized): string (node:crypto sha256 hex)
persistence/rows.ts        Zod row schemas + row→domain mappers                                          → S3.6
persistence/counters.ts    nextGlobalSeq(db)                                                             → S3.3
persistence/conversationRepo.ts                                                                          → S3.5
persistence/messageRepo.ts
persistence/responseRepo.ts
persistence/streamEventRepo.ts
domain/errors.ts           AppError + subclasses, code/status mapping                                     → S6.5
domain/conversationService.ts createConversation, listConversations, getConversationDetail               → S5.2
domain/sendMessage.ts      idempotent send, one transaction                                               → S5.3
domain/responseRunner.ts   runs provider, appends events, materializes assistant message                  → S5.4
domain/retryResponse.ts    single-retry semantics                                                         → S5.5
domain/reconcile.ts        reconcileInterruptedResponses(db, deps)  [A1]                                  → S5.6
provider/types.ts          ChatProvider, ProviderInput, ProviderChunk                                     → S4.1
provider/deterministicProvider.ts                                                                         → S4.2
provider/testVariants.ts   delayed / disconnecting / failing decorators — imported by tests only           → S4.3
stream/responseStreamHub.ts  ResponseStreamHub (Decision 2 alternative A)                                 → S7.1
stream/sseWriter.ts        frame serialization + heartbeat writer                                          → S7.3
stream/cursor.ts           resolveCursor(header, query) precedence + validation  [A2]                      → S7.4
http/errorHandler.ts       one JSON envelope, redaction, requestId                                        → S6.5
http/requestContext.ts     request id generation + structured request/failure logging                      → S6.6
http/routes/health.ts                                                                                     → S6.4
http/routes/conversations.ts  POST /api/conversations, GET /api/conversations, GET /api/conversations/:id  → S6.2
http/routes/messages.ts    POST /api/conversations/:conversationId/messages                                → S6.2
http/routes/responses.ts   POST /api/responses/:responseId/retry, GET /api/responses/:responseId/events    → S6.2, S7
testing/harness.ts         createTestServer(overrides) → { app, db, hub, deps, close }                     → S10.3
testing/tmpDatabase.ts     temp-file db per test + cleanup
testing/fakePorts.ts       counterClock, counterIdGenerator, manualScheduler
testing/sseClient.ts       in-process SSE reader: inject(), collect frames, assert order
```
Co-located tests: `persistence/*.test.ts`, `domain/*.test.ts`, `provider/deterministicProvider.test.ts`,
`stream/*.test.ts`, `http/routes/*.test.ts`, `http/errorHandler.test.ts`, `config/env.test.ts`.

### S1.3 `apps/web/src/` — client

```
main.tsx            (seed) mounts <App/> in StrictMode; imports app.css
app.css                    minimal layout; no framework
App.tsx                    shell: conversation list + thread + composer                    → S8.6
config.ts                  API base URL from import.meta.env                               → S9.2
api/client.ts              typed fetch wrappers, Zod-parse every response, ApiError        → S8.1
api/streamUrl.ts           builds /api/responses/:id/events?lastEventId=N
state/types.ts             ConversationViewState, ResponseState, Action union              → S8.2
state/conversationReducer.ts  pure reducer — the idempotency/gap engine                    → S8.3
hooks/useUrlConversationId.ts  ?conversation=<id> via pushState + popstate                 → S8.4
hooks/useConversationList.ts   list load + create + select
hooks/useConversation.ts       detail load, cursor seeding, send, retry dispatching
hooks/useResponseStream.ts     exactly one EventSource per responseId                      → S8.5
components/ConversationList.tsx
components/ConversationThread.tsx
components/MessageItem.tsx
components/Composer.tsx
components/StatusRegion.tsx    live regions + retry affordance                             → S8.7
testing/renderApp.tsx          render helpers + provider-free wiring                       → S10.4
testing/fakeEventSource.ts     controllable EventSource double (open/message/error/close)
testing/fakeFetch.ts           route-table fetch double returning contract-valid bodies
```
Co-located tests: `state/conversationReducer.test.ts`, `api/client.test.ts`, `hooks/*.test.tsx`,
`components/*.test.tsx`, `App.test.tsx`. Every `.tsx` test file starts with `// @vitest-environment jsdom`.

## S2 — Shared contracts (`packages/shared`)

Single source of truth for both apps (AC-004). Zod 4.6.5 syntax. Request bodies use `z.strictObject` so unknown
keys are a validation failure (AC-019 "malformed body").

### S2.1 `ids.ts`

```ts
export const ID_CHARSET = /^[A-Za-z0-9_-]{1,64}$/;   // permits crypto UUIDs and msg_0001-style test ids
const idBase = z.string().regex(ID_CHARSET);
export const ConversationIdSchema  = idBase.brand<"ConversationId">();
export const MessageIdSchema       = idBase.brand<"MessageId">();
export const ResponseIdSchema      = idBase.brand<"ResponseId">();
export const ClientMessageIdSchema = idBase.brand<"ClientMessageId">();
export const EventIdSchema         = z.number().int().min(1).max(MAX_EVENT_ID).brand<"EventId">();
export const SeqSchema             = z.number().int().min(1);
```
Types: `ConversationId`, `MessageId`, `ResponseId`, `ClientMessageId`, `EventId`.
Production id prefixes: `conv_`, `msg_`, `resp_` + `crypto.randomUUID()` with dashes removed.

### S2.2 `content.ts` — normalization is shared so client and server agree (Decision 4)

```ts
export const codePointLength = (value: string): number => Array.from(value).length;
export const normalizeContent = (raw: string): string => raw.normalize("NFC").trim();
export type ContentRejection = "content_empty" | "content_too_long";
export const MessageContentSchema: ZodType<string>  // transform(normalizeContent) → superRefine
```
Rules, in order: NFC → `trim()` → reject `""` with issue code `content_empty` → reject
`codePointLength > MAX_CONTENT_CODE_POINTS` with `content_too_long`. Length is counted in **Unicode code points**
(`Array.from`), never `String.length` — this is what makes the AC-019 4000/4001 cases correct for astral characters.
`normalizeContent` is also the provider's prompt normalizer (S4.2), so one function defines "same normalized message"
for FR-003/AC-003.

### S2.3 `domain.ts`

```ts
MessageRoleSchema   = z.enum(["user", "assistant"]);
ResponseStatusSchema = z.enum(["pending", "streaming", "completed", "failed"]);

ConversationSummarySchema = z.object({
  id: ConversationIdSchema, title: z.string().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  updatedSeq: SeqSchema, messageCount: z.number().int().min(0),
});

MessageSchema = z.object({
  id: MessageIdSchema, conversationId: ConversationIdSchema, seq: SeqSchema,
  role: MessageRoleSchema, content: z.string(),
  responseId: ResponseIdSchema.nullable(), createdAt: z.iso.datetime(),
});

FailureSchema = z.object({ code: FailureCodeSchema, message: z.string() });

ActiveResponseSchema = z.object({
  id: ResponseIdSchema, conversationId: ConversationIdSchema,
  status: ResponseStatusSchema,                 // only pending | streaming | failed reach the client here (S5.7)
  userMessageId: MessageIdSchema, attempt: z.number().int().min(1),
  retryOfResponseId: ResponseIdSchema.nullable(),
  partialText: z.string(), lastEventId: z.number().int().min(0),
  failure: FailureSchema.nullable(),
});
```
`lastEventId` is `0` when no event is persisted yet; it is the exact resume cursor
(`architecture-notes.md` → Decision 2 → "Contract on GET /api/conversations/:conversationId"). Without it AC-013 is
unachievable.

### S2.4 `errors.ts` — one envelope (FR-002), redaction-safe (AC-021)

```ts
ErrorCodeSchema = z.enum([
  "bad_request",                  // 400 unparseable JSON / wrong content-type
  "validation_failed",            // 400 schema failure, with issues[]
  "stream_cursor_invalid",        // 400
  "stream_cursor_out_of_range",   // 400
  "not_found",                    // 404 unknown route
  "conversation_not_found",       // 404
  "response_not_found",           // 404
  "client_message_id_conflict",   // 409
  "response_not_retryable",       // 409
  "shutting_down",                // 503
  "database_unavailable",         // 503
  "internal_error",               // 500
]);

ErrorIssueSchema = z.object({ path: z.string(), code: z.string(), message: z.string() });
ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),        // static, human-readable, from ERROR_MESSAGES — never an exception message
    requestId: z.string(),
    issues: z.array(ErrorIssueSchema).optional(),
  }),
});

FailureCodeSchema = z.enum(["provider_failed", "stream_interrupted"]);
export const ERROR_MESSAGES: Record<ErrorCode, string>;      // static map
export const FAILURE_MESSAGES: Record<FailureCode, string>;  // static map
```
- Envelope `message` is looked up by code from `ERROR_MESSAGES`. Thrown-exception text, SQL, file paths, stack
  frames, env values and message content **never** enter the envelope (AC-021).
- `issues[]` is derived from Zod `error.issues`: `{ path: issue.path.join("."), code: issue.code, message: issue.message }`.
  The offending **value** is never copied into `issues` — that is how content stays out of error bodies.
- Failure messages shown for a failed response come from `FAILURE_MESSAGES[code]`, so no failure text is persisted
  (see S3.2 — `responses` has `failure_code` and no `failure_message` column). **[spec-decision]** — keeps DDL exactly
  as Decision 1 and makes failure text unspoofable.

### S2.5 `api.ts` — one schema pair per route (S6.2 is the transport view of the same table)

```ts
CreateConversationRequestSchema  = z.strictObject({ title: z.string().trim().min(1).max(120).optional() });
CreateConversationResponseSchema = z.object({ conversation: ConversationSummarySchema });
ListConversationsResponseSchema  = z.object({ conversations: z.array(ConversationSummarySchema) });
GetConversationResponseSchema    = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(MessageSchema),                // ORDER BY seq ASC
  activeResponse: ActiveResponseSchema.nullable(),
});
PostMessageRequestSchema  = z.strictObject({ clientMessageId: ClientMessageIdSchema, content: MessageContentSchema });
PostMessageResponseSchema = z.object({
  conversationId: ConversationIdSchema, userMessageId: MessageIdSchema, responseId: ResponseIdSchema,
});
RetryResponseBodySchema = z.object({
  conversationId: ConversationIdSchema, responseId: ResponseIdSchema,      // the replacement
  userMessageId: MessageIdSchema, retryOfResponseId: ResponseIdSchema,
});
HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]), database: z.enum(["ready", "unavailable"]),
  schemaVersion: z.number().int(), uptimeMs: z.number().int().min(0),
});
ConversationParamsSchema = z.object({ conversationId: ConversationIdSchema });
ResponseParamsSchema     = z.object({ responseId: ResponseIdSchema });
StreamQuerySchema        = z.object({ lastEventId: z.string().optional() });
```
`PostMessageResponseSchema` carries exactly the two ids FR-002 names plus the conversation id. No "was this a
replay" flag — dedupe is asserted from stored state in tests (AC-008), not from the wire.

### S2.6 `events.ts` — SSE contract (FR-004)

#### S2.6.1 Payloads — no timestamps, by design

```ts
ResponseStartedDataSchema   = z.object({ responseId: ResponseIdSchema, conversationId: ConversationIdSchema,
                                         attempt: z.number().int().min(1) });
ResponseDeltaDataSchema     = z.object({ responseId: ResponseIdSchema, text: z.string().min(1) });
ResponseCompletedDataSchema = z.object({ responseId: ResponseIdSchema, assistantMessageId: MessageIdSchema,
                                         text: z.string() });
ResponseFailedDataSchema    = z.object({ responseId: ResponseIdSchema, failure: FailureSchema,
                                         partialText: z.string() });
```
**[spec-decision]** payloads contain no timestamp and no wall-clock value, so AC-003 byte-identity holds without
depending on an injected clock. Timestamps live in DB rows and REST bodies only.

#### S2.6.2 Envelope

```ts
StreamEventTypeSchema = z.enum(["response.started","response.delta","response.completed","response.failed"]);
StreamEventSchema = z.discriminatedUnion("type", [
  z.object({ id: EventIdSchema, type: z.literal("response.started"),   data: ResponseStartedDataSchema }),
  z.object({ id: EventIdSchema, type: z.literal("response.delta"),     data: ResponseDeltaDataSchema }),
  z.object({ id: EventIdSchema, type: z.literal("response.completed"), data: ResponseCompletedDataSchema }),
  z.object({ id: EventIdSchema, type: z.literal("response.failed"),    data: ResponseFailedDataSchema }),
]);
export const isTerminalEventType = (t: StreamEventType): boolean =>
  t === "response.completed" || t === "response.failed";
export const parseStreamEvent = (id: unknown, type: unknown, rawData: unknown): StreamEvent; // throws ZodError
```
Per-response invariant (AC-010, DB-enforced in S3.2): ordered integer ids starting at 1, exactly one
`response.started`, zero or more `response.delta`, exactly one terminal event, nothing after the terminal event.

**[fix, review Phase 5]** `EventIdSchema` validates `id` as `z.number()` — it does **not** accept a string, by
design, since the DB-side integer contract must stay strict. But the browser's `MessageEvent.lastEventId` (what
`EventSource` hands each listener) is a **string** per the DOM spec, and S8.5 calls
`parseStreamEvent(e.lastEventId, ...)`. `parseStreamEvent`'s `id` parameter is therefore typed `unknown` and its
first internal step is `Number(id)` (reject with a parse error if the result is `NaN`, negative, or non-integer)
before handing the numeric value to `EventIdSchema`. This coercion is local to the SSE client-parse boundary only —
every other consumer of `EventIdSchema` (DB rows, server-side route params) still passes an actual `number` and gets
strict validation with no coercion. Without this, every live/replayed event fails client-side validation and
FR-004/FR-005/FR-007 cannot work end to end.

#### S2.6.3 Client application semantics (normative — the reducer in S8.3 implements exactly this)

| Event | Effect on `ResponseState` |
| --- | --- |
| `response.started` | `status = "streaming"`, `text` unchanged |
| `response.delta` | `text += data.text` (append) |
| `response.completed` | `text = data.text` (**replace**, not append), `status = "completed"` |
| `response.failed` | `text = data.partialText` (replace), `status = "failed"`, `failure = data.failure` |

Replace-on-terminal is what makes "no duplicate text" (AC-011) a property of the data model rather than of
arithmetic: a replayed terminal event is a no-op even if deltas were applied twice by a buggy client.

#### S2.6.4 `cursor.ts`

```ts
export const CURSOR_PATTERN = /^\d+$/;            // decimal, no sign, no whitespace
export const MAX_EVENT_ID = 2_147_483_647;        // 2^31-1
export type CursorParse =
  | { ok: true; value: number }
  | { ok: false; code: "stream_cursor_invalid" };
export const parseCursor = (raw: string | undefined): CursorParse;  // undefined → { ok: true, value: 0 }
```
Out-of-range-vs-current-max is a persistence question, so it is decided in S7.4, not here.

### S2.7 `constants.ts`

```ts
MAX_CONTENT_CODE_POINTS = 4000;      // FR-010
MAX_TITLE_CODE_POINTS = 120;
SCHEMA_VERSION = 1;
PROVIDER_CHUNK_CODE_POINTS = 12;     // S4.2 — a constant, never config: config would endanger AC-003
SSE_HEARTBEAT_MS = 15_000;           // default; overridable via createServer options, not env
SSE_REPLAY_PAGE_SIZE = 200;          // drain-loop page (Decision 2 step 3)
SSE_LIVE_BUFFER_LIMIT = 500;         // bounded buffer; overflow → drop buffer, re-enter drain (Decision 2 cons)
```

## S3 — Persistence (`apps/api/src/persistence`) — Decision 1

### S3.1 `db.ts`

```ts
import { DatabaseSync } from "node:sqlite";
export const openDatabase = (path: string): DatabaseSync;   // mkdir -p dirname(path) first
export const closeDatabase = (db: DatabaseSync): void;
```
Pragmas executed at open, in this order: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`,
`synchronous=FULL`. `synchronous=FULL` is not tuning — it is what makes persist-before-emit (FR-004) meaningful.
`applySchema(db)` runs immediately after pragmas. `:memory:` is a legal path but **not** used by persistence tests:
AC-005/AC-014 need a real file that survives a close/reopen (S10.2).

### S3.2 `schema.ts` — `SCHEMA_SQL`, applied by one idempotent `applySchema(db)` inside a single transaction

```sql
CREATE TABLE IF NOT EXISTS schema_meta (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT    PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT    PRIMARY KEY,
  title       TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  updated_seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_seq
  ON conversations (updated_seq DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT    PRIMARY KEY,
  conversation_id   TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content           TEXT    NOT NULL,
  content_hash      TEXT    NOT NULL,
  client_message_id TEXT,
  response_id       TEXT    REFERENCES responses(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL,
  UNIQUE (conversation_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_message_id
  ON messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS responses (
  id                   TEXT    PRIMARY KEY,
  conversation_id      TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id      TEXT    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT    REFERENCES messages(id) ON DELETE SET NULL,
  status               TEXT    NOT NULL CHECK (status IN ('pending','streaming','completed','failed')),
  attempt              INTEGER NOT NULL DEFAULT 1,
  retry_of_response_id TEXT    REFERENCES responses(id) ON DELETE SET NULL,
  failure_code         TEXT,
  partial_text         TEXT    NOT NULL DEFAULT '',
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_responses_retry_of
  ON responses (retry_of_response_id)
  WHERE retry_of_response_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_responses_conversation
  ON responses (conversation_id);
CREATE INDEX IF NOT EXISTS idx_responses_active
  ON responses (conversation_id)
  WHERE status = 'pending' OR status = 'streaming';

CREATE TABLE IF NOT EXISTS stream_events (
  response_id TEXT    NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  event_id    INTEGER NOT NULL CHECK (event_id >= 1),
  type        TEXT    NOT NULL CHECK (type IN ('response.started','response.delta','response.completed','response.failed')),
  data        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (response_id, event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_events_one_start
  ON stream_events (response_id)
  WHERE type = 'response.started';
CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_events_one_terminal
  ON stream_events (response_id)
  WHERE type = 'response.completed' OR type = 'response.failed';
```
Notes that are part of the contract:
- S3.2.a `messages` ↔ `responses` reference each other. SQLite resolves FKs by name at statement time, so the
  **insert order is normative**: insert `messages` row with `response_id = NULL` → insert `responses` row → `UPDATE
  messages SET response_id = ?`. All three inside one transaction (S5.3).
- S3.2.b `messages.response_id` means "the response this row belongs to": for a `user` row, the response it
  triggered; for an `assistant` row, the response that produced it.
- S3.2.c Partial-index predicates use `OR`, not `IN` — SQLite's query planner recognizes the `OR`/`col = const`
  form for partial-index matching more reliably across versions than `IN (...)`; either is semantically the same
  and both satisfy Decision 1. **[spec-decision]**, style only, not a SQLite hard constraint.
- S3.2.d `applySchema` also `INSERT OR IGNORE`s `counters('global_seq', 0)` and upserts
  `schema_meta(1, SCHEMA_VERSION, now)`.
- S3.2.e No `next_event_seq` denormalization on `responses` (Decision 1, explicit): the log is the only source of
  event ids, so restart-correctness is automatic.

### S3.3 Sequence allocation — all three inside the caller's transaction

| Sequence | Allocation | Sole consumer |
| --- | --- | --- |
| `conversations.updated_seq` | `UPDATE counters SET value = value + 1 WHERE name='global_seq' RETURNING value` | `ORDER BY updated_seq DESC` (FR-001 list order) |
| `messages.seq` | `SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?` | `ORDER BY seq ASC` (thread order) |
| `stream_events.event_id` | `SELECT COALESCE(MAX(event_id),0)+1 FROM stream_events WHERE response_id = ?` | `WHERE response_id=? AND event_id>? ORDER BY event_id` (replay) |

No `ORDER BY` anywhere in product code may name `created_at` or `updated_at` (AC-007). Latest-response ordering
joins `messages.seq` instead (S5.7). The `UNIQUE`/`PRIMARY KEY` constraints make an allocation bug a loud constraint
error rather than silent reordering.

### S3.4 `transaction.ts`

```ts
export const withTransaction = <T>(db: DatabaseSync, fn: () => T): T;
```
`BEGIN IMMEDIATE` → `fn()` → `COMMIT`; on throw → `ROLLBACK` and rethrow. Nesting by depth counter:
`SAVEPOINT sp_<depth>` / `RELEASE sp_<depth>` / `ROLLBACK TO sp_<depth>`. The callback type is
**`() => T`, never `() => Promise<T>`** — that is what makes "no `await` inside a transaction" a compile-time
property (Decision 3). Reviewers: a `Promise`-returning callback here is a defect, not a style choice.

### S3.5 Repository surface (synchronous; every method takes `db` and never opens its own transaction)

```ts
// conversationRepo
insertConversation(db, row): void
findConversationById(db, id): ConversationRow | undefined
listConversationSummaries(db): ConversationSummaryRow[]          // ORDER BY updated_seq DESC
touchConversation(db, id, { updatedAt, updatedSeq }): void
// messageRepo
nextMessageSeq(db, conversationId): number
insertMessage(db, row): void
setMessageResponseId(db, messageId, responseId): void
findMessageByClientMessageId(db, conversationId, clientMessageId): MessageRow | undefined
listMessagesByConversation(db, conversationId): MessageRow[]      // ORDER BY seq ASC
countMessages(db, conversationId): number
// responseRepo
insertResponse(db, row): void
findResponseById(db, id): ResponseRow | undefined
findRetryOf(db, responseId): ResponseRow | undefined              // uq_responses_retry_of ⇒ 0 or 1 row
findActiveResponse(db, conversationId): ResponseRow | undefined   // S5.7
listNonTerminalResponses(db): ResponseRow[]                       // reconcile (S5.6)
updateResponseStatus(db, id, { status, partialText?, failureCode?, assistantMessageId?, updatedAt }): void
appendPartialText(db, id, text, updatedAt): void
// streamEventRepo
nextEventId(db, responseId): number
insertStreamEvent(db, row): void
maxEventId(db, responseId): number                                // 0 when empty
listEventsAfter(db, responseId, cursor, limit): StreamEventRow[]  // event_id > cursor ORDER BY event_id ASC
findTerminalEvent(db, responseId): StreamEventRow | undefined
```
Every query is parameterized (`db.prepare(...)`, bound values). String-built SQL is prohibited.

### S3.6 `rows.ts` — persisted records are validated too (FR-010)

One Zod schema per table (`ConversationRowSchema`, `MessageRowSchema`, `ResponseRowSchema`, `StreamEventRowSchema`),
parsing the `unknown` records `node:sqlite` returns, plus mappers `toConversationSummary`, `toMessage`,
`toActiveResponse`, `toStreamEvent` (which `JSON.parse`s `data` and validates it against the matching
`S2.6.1` payload schema). A row that fails to parse raises `internal_error` — corrupt storage is never forwarded to
the client.

## S4 — Provider (`apps/api/src/provider`) — Decision 4

### S4.1 `types.ts`

```ts
export interface ProviderInput { normalizedPrompt: string; conversationId: ConversationId; responseId: ResponseId }
export interface ProviderChunk { text: string }
export interface ChatProvider { generate(input: ProviderInput): AsyncIterable<ProviderChunk> }
```

### S4.2 `deterministicProvider.ts`

- `normalizedPrompt` is produced by `normalizeContent` (S2.2) — the same function the client and the validator use.
- Reply text is a pure total function of `normalizedPrompt`: no network, no credentials, no `Date`, no `Math.random`,
  no env read. Template (fixed; changing it is a contract change):
  `` `Echo(${codePointLength(normalizedPrompt)} cp): ${normalizedPrompt}` ``
- Chunking: `Array.from(reply)` → fixed windows of `PROVIDER_CHUNK_CODE_POINTS` code points, joined per window.
  Code-point windows — not byte slices, not `String.length` (UTF-16 units) — so no surrogate pair is ever split,
  every delta is independently valid text, and `deltas.join("") === reply` byte-for-byte on every run (AC-003).
- Emits no empty chunk (`ResponseDeltaDataSchema.text` is `min(1)`).

### S4.3 `testVariants.ts` — decorators over the same interface, injected only at the composition root

```ts
delayedProvider(base: ChatProvider, scheduler: Scheduler, delayMs: number): ChatProvider
disconnectingProvider(base: ChatProvider, afterNChunks: number): ChatProvider   // stops iterating, no terminal event
failingProvider(base: ChatProvider, afterNChunks: number, code: FailureCode): ChatProvider  // throws ProviderError
```
Delay goes through the injected `Scheduler` port, never bare `setTimeout`, so delay-ordering tests stay deterministic
without fake timers. **No env-var switch and no prompt sniffing** selects a variant — FR-003 prohibits both. The only
injection point is `createServer({ provider })` (S6.1); `apps/api/src/index.ts` always passes
`deterministicProvider`.

## S5 — Domain (`apps/api/src/domain`) — Decision 3

### S5.1 Ports (`composition/ports.ts`)

```ts
export interface Clock { now(): number }
export interface IdGenerator { conversationId(): string; messageId(): string; responseId(): string }
export interface Scheduler { sleep(ms: number): Promise<void> }
```
Production: `Date.now`, `crypto.randomUUID`, `setTimeout`. Tests: counter-based (`msg_0001`, `1700000000000 + n`)
so output is stable where it matters (`docs/ARCHITECTURE.md` → Testing).

### S5.2 `conversationService.ts`

- `createConversation(deps, { title })` — one transaction: allocate `updated_seq`, insert row. Returns summary.
- `listConversations(deps)` — `ORDER BY updated_seq DESC`.
- `getConversationDetail(deps, conversationId)` — conversation (404 `conversation_not_found` when absent), messages
  `ORDER BY seq ASC`, and `activeResponse` per S5.7 with `lastEventId = maxEventId(responseId)`.

### S5.3 `sendMessage.ts` — FR-009, AC-006/008/009; one `withTransaction`

1. Conversation must exist → else `conversation_not_found` (404).
2. `findMessageByClientMessageId(conversationId, clientMessageId)`:
   - found **and** `content_hash` equal → return the original `{ userMessageId, responseId }`. No insert, no event,
     no provider run (AC-008).
   - found **and** `content_hash` different → throw `ClientMessageIdConflict` → rollback → 409
     `client_message_id_conflict`, zero stored change (AC-009).
3. absent → in this order: insert `messages` row (`seq = MAX+1`, `response_id = NULL`, `content_hash`) → insert
   `responses` row (`status='pending'`, `attempt=1`) → `UPDATE messages SET response_id` → append
   `response.started` event (`event_id = 1`) → bump conversation `updated_at`/`updated_seq`. Commit (AC-006).
4. **After** commit, kick `responseRunner` (fire-and-forget, errors captured by the runner). Route returns 202.

Appending `response.started` inside the send transaction means the SSE endpoint is replayable the instant 202 is
returned — there is no window where a client connects and finds an empty log.

### S5.4 `responseRunner.ts`

```ts
runResponse(deps, responseId): Promise<void>   // never throws to the caller; failures become persisted events
appendEvent(deps, responseId, type, data): StreamEventRow   // one transaction, then hub.publish(row)
```
- On start: `status = 'streaming'`.
- Per provider chunk: one transaction — `event_id = MAX+1`, insert `stream_events` row, append `partial_text`,
  `updated_at` — commit, **then** `hub.publish(responseId, persistedRow)`. Persist-before-emit (FR-004) is structural:
  the hub only ever receives a row that is already committed.
- On provider exhaustion: one transaction — insert `assistant` message (`seq = MAX+1`, `role='assistant'`,
  `content = partial_text`, `response_id`), set `responses.assistant_message_id`, `status='completed'`, append
  `response.completed` with `{ assistantMessageId, text }`, bump conversation `updated_seq`. The assistant message is
  materialized **only** here (Decision 3), so a failed attempt never pollutes the thread.
- On provider throw: one transaction — `status='failed'`, `failure_code`, append `response.failed` with
  `{ failure: { code, message: FAILURE_MESSAGES[code] }, partialText }`, bump `updated_seq`. The user message and the
  persisted `partial_text` are retained (FR-008, AC-016). No assistant message row.
- Exactly one terminal append per response; the `uq_stream_events_one_terminal` index is the backstop (AC-010).

### S5.5 `retryResponse.ts` — FR-008, AC-017; one `withTransaction`

1. Response must exist → else 404 `response_not_found`.
2. `status !== 'failed'` → 409 `response_not_retryable`.
3. `findRetryOf(responseId)` returns a row → return **that** row's ids. "The same replacement response" is concretely
   *the unique row whose `retry_of_response_id` is the failed response*; `uq_responses_retry_of` guarantees at most one
   ever exists, so repeated retries are idempotent by construction, not by check-then-act.
4. Otherwise insert the replacement: new id, same `conversation_id` and **same `user_message_id`** (so AC-017's
   no-duplicate-user-message property is structural), `status='pending'`, `attempt = parent.attempt + 1`,
   `retry_of_response_id = parent.id`, append its `response.started`, bump `updated_seq`. A constraint violation from a
   racing insert is caught and converted into a re-read of the existing child (step 3).
5. After commit, kick `runResponse(replacementId)`. Route returns 202.

### S5.6 `reconcile.ts` — AC-014, assumption **[A1]**

`reconcileInterruptedResponses(deps)` runs once at startup, after `applySchema`, before `listen`: for every response
with `status IN ('pending','streaming')` and no persisted terminal event, append a persisted terminal
`response.failed` with `failure_code = 'stream_interrupted'`, retaining `partial_text`, and set `status='failed'`.
This keeps "exactly one terminal event" true, keeps the replay path uniform, and routes recovery through the existing
single-retry affordance rather than inventing a fifth response state. Recorded as an interpretation in
`docs/ASSUMPTIONS.md` **[A1]** — AC-014 fixes the observable, not the mechanism.

### S5.7 Active-response rule (normative)

`activeResponse` = the latest response of the conversation whose assistant message has not been materialized:
```sql
SELECT r.* FROM responses r
  JOIN messages m ON m.id = r.user_message_id
 WHERE r.conversation_id = ?
   AND (r.status = 'pending' OR r.status = 'streaming' OR r.status = 'failed')
 ORDER BY m.seq DESC, r.attempt DESC
 LIMIT 1;
```
Completed responses are represented by their assistant message inside `messages`, so they are never "active".
Including `failed` is what lets a refreshed page still offer retry (FR-008, AC-013, AC-018). Ordering is by
`messages.seq` + `attempt`, never by a timestamp (AC-007).

## S6 — HTTP transport (`apps/api/src/http`)

### S6.1 `composition/createServer.ts`

```ts
export interface ServerDeps {
  db: DatabaseSync; config: AppConfig; provider: ChatProvider;
  clock: Clock; ids: IdGenerator; scheduler: Scheduler;
  hub: ResponseStreamHub; logger: Logger; heartbeatMs?: number;
}
export const createServer = (deps: ServerDeps): FastifyInstance;
```
The only seam where variants (S4.3) and fake ports enter. Registers `@fastify/cors` with
`origin: [config.webOrigin]` exactly — no wildcard, no reflection (AC-023) — plus `errorHandler`, `notFoundHandler`,
`requestContext`, and the four route modules. `createServer` does **not** open the database and does **not** listen;
`index.ts` owns both.

### S6.2 Route table (FR-002)

| # | Method + path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| R1 | `POST /api/conversations` | `CreateConversationRequestSchema` (empty body `{}` allowed) | `201` `CreateConversationResponseSchema` | 400 `bad_request`, 400 `validation_failed` |
| R2 | `GET /api/conversations` | — | `200` `ListConversationsResponseSchema` | — |
| R3 | `GET /api/conversations/:conversationId` | `ConversationParamsSchema` | `200` `GetConversationResponseSchema` | 400 `validation_failed`, 404 `conversation_not_found` |
| R4 | `POST /api/conversations/:conversationId/messages` | params + `PostMessageRequestSchema` | `202` `PostMessageResponseSchema` | 400 `bad_request`/`validation_failed`, 404 `conversation_not_found`, 409 `client_message_id_conflict` |
| R5 | `POST /api/responses/:responseId/retry` | `ResponseParamsSchema` | `202` `RetryResponseBodySchema` | 400 `validation_failed`, 404 `response_not_found`, 409 `response_not_retryable` |
| R6 | `GET /api/responses/:responseId/events` | params + `StreamQuerySchema` + `Last-Event-ID` header | `200` `text/event-stream` (S7) | 400 `stream_cursor_invalid`, 400 `stream_cursor_out_of_range`, 404 `response_not_found` |
| R7 | `GET /health` | — | `200` `HealthResponseSchema` (`ok`/`ready`) | `503` `HealthResponseSchema` (`degraded`/`unavailable`) |

- All bodies/params/query are parsed with the shared schemas inside the handler (`unknown` in, typed out). Fastify's
  own JSON-schema validation is **not** used — one validation mechanism only (AC-004).
- R7 returns the health schema (not the error envelope) on 503: it is a status report, not a request failure.
  Readiness probe: `SELECT version FROM schema_meta WHERE id = 1` inside try/catch.
- R4 returns 202 because the provider run starts after the transaction commits (S5.3 step 4).

### S6.3 Response headers

JSON routes: `content-type: application/json; charset=utf-8`, `cache-control: no-store`, `x-request-id: <requestId>`.
R6 adds `content-type: text/event-stream`, `cache-control: no-store`, `connection: keep-alive`,
`x-accel-buffering: no`.

### S6.4 `routes/health.ts` — no auth, no side effects, safe to poll.

### S6.5 `errorHandler.ts` — one envelope (FR-002), redaction (AC-021)

- `domain/errors.ts` defines `AppError { code: ErrorCode; status: number; issues?: ErrorIssue[] }` and the
  subclasses `NotFoundError`, `ValidationError`, `ConflictError`, `CursorError`, `ShuttingDownError`.
- Mapping: `AppError` → its `status`/`code`; `ZodError` → 400 `validation_failed` + `issues` (S2.4);
  Fastify body-parse error → 400 `bad_request`; SQLite constraint error → 409 when it matches a known unique index,
  else 500; anything else → 500 `internal_error`.
- The envelope's `message` is always `ERROR_MESSAGES[code]`. The caught error's own `message`, `stack`, `cause`, SQL
  text, file path, env value and message content never reach the response body (AC-021). Full detail goes to the
  server log only, and the log is redacted per S6.6.
- `notFoundHandler` → 404 `not_found` in the same envelope.

### S6.6 `requestContext.ts` — structured logs without content (FR-011)

Per request: `requestId` (`ids` port or inbound `x-request-id` when it matches `ID_CHARSET`), and one log line on
completion: `{ requestId, method, routePath, status, durationMs, conversationId?, responseId?, contentCodePoints?, errorCode? }`.
Prohibited log fields: message `content`, `partial_text`, delta text, SQL, env values, absolute paths. Content is
logged only as a **length** (`contentCodePoints`).

### S6.7 `index.ts` — operational behavior (FR-011)

`loadConfig(process.env)` → `openDatabase(config.dbPath)` (applies schema) → `reconcileInterruptedResponses` →
`new ResponseStreamHub()` → `createServer(deps)` → `listen({ host, port })`.
`SIGINT`/`SIGTERM` (once, idempotent): set shutting-down (new requests → 503 `shutting_down`) → `hub.closeAll()`
(flush nothing, end every SSE response) → `app.close()` → `closeDatabase(db)` → `process.exit(0)`. Unhandled
rejection / uncaught exception: log with `errorCode`, then the same shutdown path.

## S7 — Stream coordination (`apps/api/src/stream`) — Decision 2, alternative A

### S7.1 `responseStreamHub.ts`

```ts
export interface HubSubscription { readonly buffered: StreamEventRow[]; unsubscribe(): void }
export class ResponseStreamHub {
  attach(responseId: string, onPublish: (row: StreamEventRow) => void): HubSubscription;
  publish(responseId: string, row: StreamEventRow): void;   // called only by appendEvent, only post-commit
  closeAll(): void;                                         // shutdown
  readonly size: number;                                    // channel count, for leak assertions in tests
}
```
One channel per `responseId`; a channel is disposed when its last subscriber leaves **and** the response is terminal.
Channels keyed by `responseId` make cross-response leakage structurally impossible (FR-005) — there is no shared bus.
`publish` receives the **persisted row**, never an in-flight provider chunk, so live and replayed bytes are identical
by construction.

### S7.2 Subscriber lifecycle (R6 handler) — normative order

1. Validate `responseId` (`ResponseParamsSchema`) and resolve the cursor (S7.4). Respond 404/400 **before any byte of
   the stream body is written**.
2. Write SSE headers. `attach(responseId)` — live publishes now accumulate in the subscription's bounded buffer;
   nothing is written yet.
3. Drain loop: `listEventsAfter(responseId, lastSent, SSE_REPLAY_PAGE_SIZE)` repeatedly, writing each row and
   advancing `lastSent`, until a page returns empty.
4. Flush the buffer, dropping rows with `event_id <= lastSent`.
5. Steady state: write live publishes as they arrive. Buffer overflow (`> SSE_LIVE_BUFFER_LIMIT`) → discard the buffer
   and re-enter step 3; always safe, because the log is authoritative.
6. On a terminal event (written from either path, or already present in the replay): write it, unsubscribe, end the
   response. On client disconnect (`request.raw.on("close")`): unsubscribe, clear the heartbeat.

Subscribe-then-drain closes the yield window an `await` on socket backpressure opens: events appended between "replay
query returned" and "live subscription active" are neither lost nor duplicated. Dedupe is a monotonic-integer
comparison, which is the whole reason a single cursor suffices.

### S7.3 `sseWriter.ts` — frame format

```
id: <event_id>\n
event: <type>\n
data: <JSON.stringify(data)>\n
\n
```
- Exactly one `data:` line per frame — `JSON.stringify` never emits a raw newline, so multi-line `data` folding is not
  needed and is prohibited (it would change the bytes a replay produces).
- Heartbeat: `: ping\n\n` every `heartbeatMs`. Comment lines carry no `id:`, so they cannot perturb any cursor.
- The payload is validated against its `S2.6.1` schema before it is written.

### S7.4 `cursor.ts` — `Last-Event-ID`, `?lastEventId=N`, assumption **[A2]**

```ts
resolveCursor(headerValue: string | undefined, queryValue: string | undefined, maxEventId: number):
  { ok: true; cursor: number } | { ok: false; code: "stream_cursor_invalid" | "stream_cursor_out_of_range" }
```
Precedence: **header wins when both are present** (a browser-managed reconnect is authoritative), else the query
param, else `0`. `EventSource` cannot set request headers, so the first connect after a refresh must pass the cursor
as `?lastEventId=N`; the query param is an *addition* to the FR-005 header contract, never a substitute — the server
still honors `Last-Event-ID`.

The four AC-012 cases, each with its own stable code:

| Case | Input | Result |
| --- | --- | --- |
| missing | absent from both | `cursor = 0`, full replay |
| malformed | not `/^\d+$/` (`"abc"`, `"1.5"`, `" 3"`, `""`) | 400 `stream_cursor_invalid` |
| negative | `"-1"` (fails the pattern), or a number `< 0` | 400 `stream_cursor_invalid` |
| beyond current | `> maxEventId(responseId)` (also `> MAX_EVENT_ID`) | 400 `stream_cursor_out_of_range` |

`cursor === maxEventId` is valid and means "nothing to replay" — not out of range.

## S8 — Web client (`apps/web/src`) — Decision 5

### S8.1 `api/client.ts`

One function per route (`createConversation`, `listConversations`, `getConversation`, `postMessage`, `retryResponse`,
`getHealth`). Each: `fetch` → on `!ok`, parse `ErrorEnvelopeSchema` and throw
`ApiError { code, message, requestId, issues, status }` (falling back to `internal_error` when the body is not an
envelope) → on ok, parse the route's response schema and return the typed value. No `any`, no unchecked `as`.

### S8.2 `state/types.ts`

```ts
type ResponseUiStatus = "pending" | "streaming" | "completed" | "failed" | "reconnecting" | "retrying";
interface ResponseState { responseId: ResponseId; status: ResponseUiStatus; text: string;
                          lastAppliedEventId: number; failure: { code: string; message: string } | null }
interface ConversationViewState {
  conversationId: ConversationId | null;
  loadState: "idle" | "loading" | "ready" | "error";
  messages: Message[];                       // ordered by seq
  response: ResponseState | null;            // at most one active response per FR-008 (single retry, no fan-out)
  composerStatus: "idle" | "sending" | "error";
  error: { code: string; message: string } | null;
}
type Action =
  | { kind: "detail_loaded"; detail: GetConversationResponse }
  | { kind: "send_started"; clientMessageId: ClientMessageId; content: string }
  | { kind: "send_accepted"; userMessageId: MessageId; responseId: ResponseId }
  | { kind: "send_failed"; error: { code: string; message: string } }
  | { kind: "stream_event"; event: StreamEvent }
  | { kind: "stream_disconnected" }
  | { kind: "retry_started" }
  | { kind: "retry_accepted"; responseId: ResponseId }
  | { kind: "error_dismissed" };
```
`status` extends the four server statuses with the two *client-only* states `reconnecting` and `retrying` (FR-001).

### S8.3 `state/conversationReducer.ts` — pure, the idempotency engine (FR-007, AC-013)

`stream_event` is decided by the single integer cursor:

| Condition | Action |
| --- | --- |
| `event.id <= lastAppliedEventId` | **drop** — return state unchanged (idempotent replay) |
| `event.id === lastAppliedEventId + 1` | apply per S2.6.3, set `lastAppliedEventId = event.id` |
| `event.id > lastAppliedEventId + 1` | **gap** — do not apply; `status = "reconnecting"`, cursor unchanged, so the stream hook reconnects from `lastAppliedEventId` |

Other rules: `detail_loaded` seeds `response` from `activeResponse` with
`text = partialText`, `lastAppliedEventId = activeResponse.lastEventId`, mapping server `status` straight through;
`send_started` appends an optimistic user message and sets `composerStatus = "sending"`; `send_accepted` replaces the
optimistic id with the persisted one and creates `response` with `status = "pending"`, `lastAppliedEventId = 0`;
`retry_started` sets `status = "retrying"`; `retry_accepted` replaces `response` with a fresh state for the
replacement id (`text = ""`, `lastAppliedEventId = 0`); `stream_disconnected` sets `reconnecting` unless the status is
already terminal. The reducer never fetches, never touches `window`, and never reads a clock — it is unit-testable in
the default (node) Vitest environment.

### S8.4 `hooks/useUrlConversationId.ts`

`?conversation=<id>` read on mount, written with `history.pushState`, kept in sync by a `popstate` listener. Query
param, not a path segment, so Vite dev needs no history fallback; hand-rolled, because a router would be a new
runtime dependency (S0.7).

### S8.5 `hooks/useResponseStream.ts`

Owns exactly one `EventSource` on `/api/responses/:id/events?lastEventId=N`. The effect is keyed on `responseId`
**only**; the cursor is read from a ref — keying on the cursor would tear down and rebuild the connection on every
delta. `addEventListener` for each of the four event types → `parseStreamEvent(e.lastEventId, type, JSON.parse(e.data))`
→ `dispatch({ kind: "stream_event" })`; a parse failure is surfaced as an error state, never applied. `onerror` →
`dispatch({ kind: "stream_disconnected" })` and let `EventSource` retry with its own `Last-Event-ID`. A terminal event
→ `close()` deliberately. Because every received event is applied synchronously in the reducer, the browser's
`Last-Event-ID` and `lastAppliedEventId` cannot diverge.

### S8.6 Refresh path (AC-013)

mount → conversation id from the URL → `GET /api/conversations/:id` → `detail_loaded` seeds the cursor from
`activeResponse.lastEventId` → connect with `?lastEventId=<that>`. No delta re-applied, none skipped. Refresh during a
stream is therefore the ordinary reconnect path, not a special case.

### S8.7 Accessibility and escaping (FR-001, FR-010, AC-018/020/022)

- `role="status" aria-live="polite"` for `sending | streaming | completed | reconnecting | retrying`;
  `role="alert"` for `failed`, with focus moved to the retry `<button>`; `aria-busy` on the streaming text region.
- The live region announces **state transitions only, never delta text** — announcing deltas floods a screen reader.
- The four failure kinds are distinguishable states with distinct text and a usable next action (AC-018): network
  disconnect → `reconnecting` (no user action, retry is automatic), API error → `error` + dismiss, validation error →
  inline composer message + focus back to the textarea, provider failure → `failed` + retry button.
- Composer: labelled `<textarea>`, Enter sends, Shift+Enter inserts a newline, disabled while `sending`. Conversation
  list: native `<button>` elements in a list, reachable and operable by keyboard only (AC-022).
- All user and provider text renders as text children. `dangerouslySetInnerHTML` is prohibited; no markdown, no HTML
  sanitizer (nothing to sanitize). A grep for `dangerouslySetInnerHTML` in `apps/web` returning nothing is part of the
  AC-020 evidence.

## S9 — Configuration surface (resolves the ACTIVE "Configuration surface is undefined" assumption)

### S9.1 API — `config/env.ts`, validated with Zod at startup (FR-010); process exits non-zero on failure

| Variable | Type / rule | Default | Consumer |
| --- | --- | --- | --- |
| `CHAT_DB_PATH` | non-empty string | `./data/chat.sqlite` | S3.1 (FR-006) |
| `CHAT_API_HOST` | non-empty string | `127.0.0.1` | S6.7 |
| `CHAT_API_PORT` | int 1–65535 (coerced) | `8787` | S6.7 |
| `CHAT_WEB_ORIGIN` | absolute http(s) URL | `http://localhost:5173` | CORS allowlist, S6.1 (AC-023) |
| `CHAT_LOG_LEVEL` | `fatal\|error\|warn\|info\|debug` | `info` | S6.6 |

`data/` and `*.sqlite*` are already gitignored (FR-011). Ship `.env.example` with these five names; no `.env` loader
is added (Node 24 supports `--env-file` natively, and a loader library would be a boundary change).

### S9.2 Web — `config.ts`

`VITE_API_BASE_URL`, default `http://localhost:8787`, validated as an absolute URL at module load.

## S10 — Testing contract (`docs/ARCHITECTURE.md` → Testing; FR quality requirements; AC-024)

- S10.1 Vitest is the only runner; `vitest.config.ts` gains (a) `resolve.alias` mapping
  `@rosetta-poc/chat-shared` → `packages/shared/src/index.ts`, so tests never depend on `packages/shared/dist` having
  been built (the `check` gate runs `test` before `build`), and (b) nothing else global. Browser tests declare
  `// @vitest-environment jsdom` per file, keeping node-side tests in the default environment (per `docs/TODO.md`).
- S10.2 Every persistence/integration test uses a **temporary file** database via `testing/tmpDatabase.ts`
  (`mkdtemp` + unlink in `afterEach`), never `:memory:` — AC-005/AC-014 require surviving a close/reopen.
- S10.3 API tests drive the Fastify instance with `app.inject()` from `testing/harness.ts`; SSE tests read the
  injected stream with `testing/sseClient.ts` and assert on the ordered frame list. Deterministic ports
  (`testing/fakePorts.ts`) wherever output stability matters.
- S10.4 Component tests use Testing Library + `testing/fakeEventSource.ts` (installed on `globalThis`) and
  `testing/fakeFetch.ts`, which returns bodies parsed by the **shared schemas** — a drifted contract fails the web
  tests too.
- S10.5 Mock external boundaries only (provider, `EventSource`, `fetch`, clock, ids, scheduler). Never mock the module
  under test, never mock the repositories in domain tests — those run against a real temp SQLite file.

## S11 — Traceability

### S11.1 FR → spec sections

| FR | Spec sections |
| --- | --- |
| FR-001 Conversation interface | S8.2, S8.3, S8.6, S8.7, S1.3; list order S3.3/S5.2 |
| FR-002 HTTP API | S6.2 (R1–R7), S2.5, S6.3, S6.5 |
| FR-003 Deterministic mock provider | S4.1, S4.2, S4.3, S6.1 |
| FR-004 Streaming protocol | S2.6, S7.1, S7.2, S7.3, S5.4 (persist-before-emit) |
| FR-005 Stream reconnection | S7.2, S7.4, S3.5 (`listEventsAfter`), S7.1 (per-response channels) |
| FR-006 Persistence | S3.1, S3.2, S3.3, S3.4, S9.1 |
| FR-007 Refresh and resume | S2.3 (`lastEventId`), S8.3, S8.4, S8.5, S8.6 |
| FR-008 Failure and retry | S5.4 (fail path), S5.5, S5.7, S8.7 |
| FR-009 Message idempotency | S5.3, S3.2 (`uq_messages_client_message_id`), S2.5 |
| FR-010 Validation and boundaries | S2.2, S2.5, S3.6, S6.2, S6.5, S8.7, S9.1 |
| FR-011 Operational behavior | S6.6, S6.7, S9.1 (gitignored artifacts) |
| Quality: layer separation | S1.1–S1.3 (one directory per layer), S6.1 |
| Quality: no `any` | S0.3 |
| Quality: test kinds | S10.1–S10.5 |

### S11.2 AC → spec section + evidence location

Evidence paths are where the implementing session must put the test; they are the AC-025 mapping targets.

| AC | Spec | Evidence |
| --- | --- | --- |
| AC-001 clean `npm ci` + `npm run check` | S0.6, S10.1, S9.1 | manual run recorded in the experiment log; PLAN M0/M11 done-checks |
| AC-002 create/send/stream/complete | S6.2 R1/R4/R6, S8.3, S8.6 | `apps/web/src/App.test.tsx` |
| AC-003 byte-identical provider output | S4.2, S2.6.1 (no timestamps) | `apps/api/src/provider/deterministicProvider.test.ts` |
| AC-004 shared contracts validate all bodies + SSE | S2.*, S6.2, S8.1, S10.4 | `packages/shared/src/*.test.ts`, `apps/api/src/http/routes/*.test.ts` |
| AC-005 survive API restart | S3.1, S3.2 | `apps/api/src/persistence/restart.test.ts` |
| AC-006 atomic message+response | S3.4, S5.3 | `apps/api/src/domain/sendMessage.test.ts` |
| AC-007 deterministic order at equal timestamps | S3.3, S5.7, S3.5 | `apps/api/src/persistence/messageRepo.test.ts` |
| AC-008 duplicate `clientMessageId` | S5.3 step 2, S3.2 | `apps/api/src/domain/sendMessage.test.ts` |
| AC-009 key reuse with different content → 409 | S5.3 step 2, S2.4 | `apps/api/src/domain/sendMessage.test.ts`, `http/routes/messages.test.ts` |
| AC-010 event-log invariants | S2.6.2, S3.2 (partial unique indexes), S5.4 | `apps/api/src/persistence/streamEventRepo.test.ts` |
| AC-011 `Last-Event-ID` replay | S7.2, S7.4, S2.6.3 | `apps/api/src/stream/replay.test.ts` |
| AC-012 four cursor cases | S7.4 table | `apps/api/src/stream/cursor.test.ts`, `http/routes/responses.test.ts` |
| AC-013 refresh mid-response | S2.3, S8.3, S8.6 | `apps/web/src/hooks/useConversation.test.tsx`, `state/conversationReducer.test.ts` |
| AC-014 interrupted response recoverable | S5.6 **[A1]**, S3.2 | `apps/api/src/domain/reconcile.test.ts` |
| AC-015 GOV-004 session recovery | this file + PLAN exist and are committed | experiment log; not a product test |
| AC-016 provider failure persisted safely | S5.4 fail path, S2.4 | `apps/api/src/domain/responseRunner.test.ts` |
| AC-017 single retry | S5.5, S3.2 (`uq_responses_retry_of`) | `apps/api/src/domain/retryResponse.test.ts` |
| AC-018 distinguishable accessible states | S8.7, S8.2 | `apps/web/src/components/StatusRegion.test.tsx` |
| AC-019 validation cases | S2.2, S2.5, S6.5 | `packages/shared/src/content.test.ts`, `apps/api/src/http/routes/messages.test.ts` |
| AC-020 HTML-looking text renders as text | S8.7 | `apps/web/src/components/MessageItem.test.tsx` |
| AC-021 no leakage in client errors | S2.4, S6.5, S6.6 | `apps/api/src/http/errorHandler.test.ts` |
| AC-022 keyboard-only flow | S8.7 | `apps/web/src/App.test.tsx` (user-event, no pointer) |
| AC-023 CORS allowlist | S6.1, S9.1 | `apps/api/src/http/cors.test.ts` |
| AC-024 all five test kinds present and passing | S10.* | `npm test` output |
| AC-025 requirement→evidence mapping | S11.1, S11.2 | review artifact produced in PLAN M12 |
| AC-026 deferrals and corrections recorded | — | experiment log + `docs/ASSUMPTIONS.md`, PLAN M12 |

### S11.3 Assumption disposition

| ID | Where implemented | Resolution step |
| --- | --- | --- |
| **[A1]** interrupted-response reconciliation | S5.6 | after AC-014 passes, move the fact to `docs/ARCHITECTURE.md` → stream coordination and mark RESOLVED (PLAN M12) |
| **[A2]** `?lastEventId` cursor channel | S7.4, S8.5 | after AC-011/AC-012 pass, same treatment (PLAN M12) |
| Configuration surface undefined | S9.1, S9.2 | `.env.example` + this table; mark RESOLVED in PLAN M12 |
| `node:sqlite` unversioned | S3.1 | record the concrete import in `docs/PATTERNS/` (PLAN M12) |

## S12 — Explicitly out of scope

Per `docs/REQUIREMENTS.md` → Non-goals: auth, multi-user, WebSockets, attachments, markdown, tools, conversation
editing/branching/search/export, multiple or automatic retries, multi-process stream coordination, benchmarking. No
spec section above may be read as authorizing any of these. Notably, `ResponseStreamHub` is deliberately
process-local (S7.1) and `retryResponse` deliberately supports exactly one retry per failed response (S5.5).
