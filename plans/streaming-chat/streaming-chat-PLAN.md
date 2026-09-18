# Execution Plan — Streaming Chat (Phase 4, LARGE)

**The HOW.** Sequenced, independently-committable milestones. The WHAT is
`plans/streaming-chat/streaming-chat-SPECS.md` (sections `S0`–`S12`, referenced below, never restated).
Design rationale is `plans/streaming-chat/architecture-notes.md` (Decisions 1–5, binding).
Requirements/criteria are `docs/REQUIREMENTS.md` (FR-001..FR-011) and `docs/ACCEPTANCE-CRITERIA.md` (AC-001..AC-026).

## P0 — Why this plan is shaped this way (read if you are a fresh session)

This branch (`experiment/GOV-004`) is the **interrupted-session recovery** experiment
(`docs/EXPERIMENT-BOUNDARY.md` → GOV-004 protocol, AC-015). The frozen protocol is: stop **deliberately, before any
product-code edit**, once committed planning artifacts are sufficient to resume; a later, fresh Claude Code session
with **no conversational context** then records what it can recover from the repository alone. **This plan's own
existence is the stopping point of the current evaluator run** — the current session does not execute M0 or any
later milestone. Everything below (M0–M12, the checkpoint discussion in P6) describes work for whichever session
performs the actual implementation after this recovery experiment concludes, not for the session that authored this
plan. Therefore:

- P0.1 Every milestone leaves the repo coherent: it typechecks, and `npm run check` passes at the end of each
  milestone. A milestone is never half-landed.
- P0.2 Milestones are ordered so each is a usable building block for the next: shared contracts → persistence →
  provider → domain/idempotency → HTTP transport → SSE/stream coordination → frontend → cross-cutting → evidence.
- P0.3 One commit per milestone (more is fine; fewer is not). Commit message: `feat(<layer>): M<n> <goal>` with a body
  listing the FR/AC advanced, so `git log --oneline` alone reveals the resume point.
- P0.4 **This evaluator run's actual boundary is immediately after plan approval, before M0** — no product code is
  written in this session. **M6 is only a suggested future implementation checkpoint** (P6 below), offered for
  whichever session later performs the implementation; it is not where this session stops, because this session does
  not begin implementation at all.
- P0.5 The plan is the durable artifact. Do not delete or rewrite a milestone when it is done — append `[DONE <sha>]`
  to its header instead. That is how the next session reads progress.

## P1 — How to resume (context-free entry procedure)

1. `git log --oneline -15` — the last `M<n>` commit is the completed milestone; the next one is your starting point.
   Cross-check against `[DONE]` markers in this file.
2. Read, in order: `docs/REQUIREMENTS.md`, `docs/ACCEPTANCE-CRITERIA.md`, `docs/ARCHITECTURE.md`,
   `plans/streaming-chat/architecture-notes.md`, `plans/streaming-chat/streaming-chat-SPECS.md`, this file,
   `docs/ASSUMPTIONS.md`.
3. `npm ci && npm run check` — must pass before you write anything. If it fails on a clean tree, fixing that is your
   first task (see P3 R1).
4. `ls apps/api/src apps/web/src packages/shared/src` against `S1` — the file layout tells you what exists.
5. Do not redesign. `architecture-notes.md` is human-approved and binding; `SPECS.md` is its operationalization. A
   genuine defect in `SPECS.md` is fixed by editing `SPECS.md` and recording the change, never by silent divergence
   (`docs/ASSUMPTIONS.md` → "Rosetta-generated docs are subordinate").
6. Never modify `docs/REQUIREMENTS.md`, `docs/ACCEPTANCE-CRITERIA.md`, `docs/ARCHITECTURE.md`,
   `docs/EXPERIMENT-BOUNDARY.md`, or `plans/streaming-chat/architecture-notes.md`.

## P2 — Milestone map

| # | Milestone | Layer | STOP-safe |
| --- | --- | --- | --- |
| M0 | Tooling and resolution wiring | build/test config | yes |
| M1 | Shared contracts | `packages/shared` | yes |
| M2 | Persistence: db, schema, transaction, repos | `apps/api` persistence | yes |
| M3 | Deterministic provider + test variants | `apps/api` provider | yes |
| M4 | Domain: send, run, retry, reconcile | `apps/api` domain | yes |
| M5 | HTTP transport, non-streaming routes | `apps/api` http | yes |
| M6 | Bootstrap, config, health, shutdown | `apps/api` ops | suggested future checkpoint (see P0.4, P6) |
| M7 | Stream coordination + SSE endpoint | `apps/api` stream | yes |
| M8 | Web foundation: client, reducer, URL hook | `apps/web` state | yes |
| M9 | Web UI + stream hook | `apps/web` components | yes |
| M10 | Component tests and a11y/XSS evidence | `apps/web` tests | yes |
| M11 | Hardening: redaction, CORS, restart evidence | cross-cutting | yes |
| M12 | Traceability, docs, assumption closure | docs/evidence | yes |

Thirteen milestones (M0–M12). M0–M6 = server-side core, provable with `npm run check` alone. M7–M12 = streaming,
client, and evidence.

## P3 — Known hazards, decided up front (do not rediscover these)

- **R1 cross-package resolution vs. the `check` order.** Root `check` runs `typecheck → test → build`, so
  `packages/shared/dist` may not exist when `apps/api` typechecks or when tests import
  `@rosetta-poc/chat-shared` (whose `exports` points at `dist/index.js`). Mitigations, in order of preference:
  (a) `resolve.alias` in `vitest.config.ts` → `packages/shared/src/index.ts` (fixes tests — `S10.1`);
  (b) `resolve.alias` in `apps/web/vite.config.ts` → same target (fixes `vite build` regardless of workspace order);
  (c) if `tsc -p apps/api` still cannot resolve the package types on a clean tree, add a root
  `"pretypecheck": "npm run build -w @rosetta-poc/chat-shared"`. (c) keeps the documented `check` composition
  (`docs/ARCHITECTURE.md` → Build and verification) intact — it only guarantees declarations exist first. Verify by
  `rm -rf packages/shared/dist apps/*/dist && npm run check`. This is M0's main job; getting it wrong makes AC-001
  fail at the very end, which is the worst possible time.
- **R2 `.js` extensions.** `apps/api` and `packages/shared` are `NodeNext` + `verbatimModuleSyntax`: relative imports
  must end in `.js` (`S0.1`). `apps/web` must not (Bundler resolution).
- **R3 `node:sqlite` is experimental** on Node 24 and prints a warning on import. Expected; do not silence it with a
  flag in product code. `docs/ASSUMPTIONS.md` records the decision to use it without a wrapper.
- **R4 SSE cannot be tested with plain `app.inject()`** — inject resolves only when the response ends, and a live
  stream does not end. Use a real listener (`app.listen({ port: 0 })`) plus global `fetch` and
  `response.body.getReader()`, parsing frames incrementally (`S10.3`). `payloadAsStream: true` is acceptable for
  replay-only cases where the response is already terminal.
- **R5 jsdom has no `EventSource`.** Component tests install `testing/fakeEventSource.ts` on `globalThis`
  (`S10.4`); production code must therefore not capture `EventSource` at module scope.
- **R6 Emitted test files.** `tsc -p` copies co-located tests and `src/testing/**` into `dist/`. Accepted (`S0.6`);
  do not "fix" it by excluding them from the tsconfig, which would also exclude them from typechecking.
- **R7 No new runtime dependency** without a recorded study deviation (`S0.7`).

---

## M0 — Tooling and resolution wiring

- **Goal.** Make cross-package imports, browser tests, and the clean-checkout gate work *before* any product code
  depends on them.
- **Dependencies.** none.
- **Files.** `vitest.config.ts` (add `resolve.alias` for `@rosetta-poc/chat-shared`); `apps/web/vite.config.ts` (same
  alias); root `package.json` only if R3-(c) proves necessary; `.env.example` (new, five names from `S9.1`);
  `apps/web/.env.example` or a documented `VITE_API_BASE_URL` default (`S9.2`); `.nvmrc` if absent (Node 24.21.0);
  one throwaway `packages/shared/src/smoke.test.ts` asserting the alias resolves, deleted in M1 when real tests exist.
- **Done.** `rm -rf packages/shared/dist apps/api/dist apps/web/dist && npm ci && npm run check` passes; a
  `// @vitest-environment jsdom` test file can `document.createElement`.
- **Advances.** AC-001, AC-024 (infrastructure), `docs/TODO.md` → jsdom environment item.
- **Commit.** `chore(build): M0 wire cross-package resolution, jsdom env, config surface`

## M1 — Shared contracts

- **Goal.** `packages/shared` exports every schema in `S2`, with types derived from schemas. One barrel entry.
- **Dependencies.** M0.
- **Files.** `packages/shared/src/{index,ids,content,domain,errors,api,events,cursor,constants}.ts` + co-located
  `{ids,content,errors,api,events,cursor}.test.ts`. Delete `smoke.test.ts`.
- **Tests to write.** code-point counting for astral characters; the 4000 / 4001 boundary; whitespace-only rejection;
  NFC-then-trim order; `strictObject` rejects unknown keys; `parseCursor` on `"" | "abc" | "1.5" | " 3" | "-1" | "0" |
  "1" | String(MAX_EVENT_ID+1)`; `StreamEventSchema` discriminated-union acceptance and rejection per type; error
  envelope shape and `ERROR_MESSAGES` completeness over `ErrorCode`.
- **Done.** `npm run check` passes; `packages/shared/src/*.test.ts` green; no `any`; `apps/api` and `apps/web` still
  compile (they import nothing yet).
- **Advances.** FR-002 (bodies), FR-004 (event shapes), FR-010 (validation), AC-004, AC-019 (unit half).
- **Commit.** `feat(shared): M1 runtime contracts for API bodies, SSE events, ids, content rules`

## M2 — Persistence

- **Goal.** A real SQLite file with the `S3.2` schema, the synchronous transaction helper, and typed repositories.
  No HTTP, no provider, no domain rules yet.
- **Dependencies.** M1 (row schemas reuse shared id/payload schemas).
- **Files.** `apps/api/src/persistence/{db,schema,transaction,hash,rows,counters,conversationRepo,messageRepo,responseRepo,streamEventRepo}.ts`;
  `apps/api/src/composition/{ports,clock,ids,scheduler}.ts`; `apps/api/src/testing/{tmpDatabase,fakePorts}.ts`;
  tests `persistence/{schema,transaction,messageRepo,responseRepo,streamEventRepo,restart}.test.ts`.
- **Tests to write.** `applySchema` is idempotent (run twice, same `schema_meta`); `withTransaction` rolls back an
  injected throw leaving zero rows; nested savepoint rollback; `messages.seq` and `stream_events.event_id` allocate
  `MAX+1`; `UNIQUE(conversation_id, seq)` and the composite PK reject duplicates; the three partial unique indexes
  reject a second start / second terminal / second retry; ordering is stable when every `created_at` is byte-identical
  (**AC-007**); close + reopen the same file preserves rows (**AC-005**); `listEventsAfter` returns only
  `event_id > cursor` in ascending order.
- **Done.** `npm run check` passes; no `ORDER BY` in `apps/api/src` mentions a timestamp
  (`grep -rn "ORDER BY" apps/api/src`).
- **Advances.** FR-006, AC-005, AC-007, AC-010 (DB half).
- **Commit.** `feat(api): M2 SQLite schema, sync transactions, typed repositories`

## M3 — Deterministic provider

- **Goal.** The injected provider interface, the deterministic default, and the three test decorators.
- **Dependencies.** M1 (`normalizeContent`, `PROVIDER_CHUNK_CODE_POINTS`), M2 (`Scheduler` port).
- **Files.** `apps/api/src/provider/{types,deterministicProvider,testVariants}.ts`;
  `provider/deterministicProvider.test.ts`, `provider/testVariants.test.ts`.
- **Tests to write.** two independent runs over the same normalized prompt produce identical chunk arrays
  (**AC-003**); `chunks.join("") === reply`; no chunk splits a surrogate pair (emoji-heavy and CJK prompts); no chunk
  is empty; a grep-level assertion that the module imports nothing from `node:*` beyond types and touches no
  `Date`/`Math.random`; decorators preserve chunk content and only alter timing/termination.
- **Done.** `npm run check` passes; provider tests green with no fake timers.
- **Advances.** FR-003, AC-003.
- **Commit.** `feat(api): M3 deterministic provider with code-point chunking and test decorators`

## M4 — Domain: send, run, retry, reconcile

- **Goal.** All state-transition rules and both idempotency keys, exercised directly against a temp database — no HTTP
  in the way.
- **Dependencies.** M2, M3.
- **Files.** `apps/api/src/domain/{errors,conversationService,sendMessage,responseRunner,retryResponse,reconcile}.ts`;
  tests `domain/{conversationService,sendMessage,responseRunner,retryResponse,reconcile}.test.ts`.
- **Tests to write.** duplicate identical `clientMessageId` → same ids, no second message/response/event, provider not
  invoked (**AC-008**); same key + different content → conflict thrown, zero stored change (**AC-009**); an injected
  failure mid-send leaves neither message nor response (**AC-006**); happy run produces
  `started → deltas… → completed`, exactly one assistant message, `partial_text` equal to the assistant content
  (**AC-010**); `failingProvider` yields one persisted `response.failed`, retains the user message and `partial_text`,
  and creates no assistant message (**AC-016**); retry of a failed response reuses `user_message_id`, and a second
  retry call returns the same replacement id (**AC-017**); retry of a non-failed response → `response_not_retryable`;
  `disconnectingProvider` + reopen + `reconcileInterruptedResponses` → exactly one terminal `stream_interrupted`
  event, status `failed`, `partial_text` retained, retry available (**AC-014**); `activeResponse` selection per `S5.7`
  with identical timestamps.
- **Done.** `npm run check` passes; every AC in the list above has a named test.
- **Advances.** FR-008, FR-009, AC-006, AC-008, AC-009, AC-014, AC-016, AC-017, AC-010.
- **Commit.** `feat(api): M4 idempotent send, response runner, single retry, startup reconciliation`

## M5 — HTTP transport, non-streaming routes

- **Goal.** Routes R1–R5 of `S6.2` behind one error envelope. The API is usable end-to-end except streaming.
- **Dependencies.** M4.
- **Files.** `apps/api/src/composition/createServer.ts`; `apps/api/src/http/{errorHandler,requestContext}.ts`;
  `apps/api/src/http/routes/{conversations,messages,responses}.ts` (retry only; the events route is a stub returning
  501 `internal_error` or is simply not registered yet — prefer **not registered**, so no misleading surface exists);
  `apps/api/src/testing/harness.ts`; tests `http/routes/{conversations,messages,responses}.test.ts`,
  `http/errorHandler.test.ts`.
- **Tests to write.** R1 201 + summary shape; R2 ordering by `updated_seq DESC` with identical timestamps; R3 404 and
  full detail shape including `activeResponse.lastEventId`; R4 202 with both ids, 409 on key conflict, 400 on
  whitespace-only / 4001 code points / malformed JSON / unknown key / invalid path id (**AC-019**); R5 202 twice
  returning the same replacement; every error body parses as `ErrorEnvelopeSchema` and contains no stack frame, SQL
  fragment, absolute path, or message content (**AC-021**).
- **Done.** `npm run check` passes; `curl` against a manually started server performs create → send → poll detail and
  shows the completed assistant message (recorded in the experiment log).
- **Advances.** FR-002, FR-009, FR-010, AC-004, AC-019, AC-021.
- **Commit.** `feat(api): M5 Fastify routes for conversations, messages, retry with one error envelope`

## M6 — Bootstrap, config, health, shutdown  ← **suggested future checkpoint, not this session's boundary (see P0.4)**

- **Goal.** A runnable server: validated env config, `GET /health`, startup reconciliation, clean shutdown.
- **Dependencies.** M5.
- **Files.** `apps/api/src/config/env.ts`; `apps/api/src/http/routes/health.ts`; `apps/api/src/index.ts` (replaces the
  seed placeholder); tests `config/env.test.ts`, `http/routes/health.test.ts`.
- **Tests to write.** missing/invalid env → typed failure with field details, no value echoed; defaults applied; health
  200 on a ready db and 503 `degraded` when the schema read throws; shutdown closes the db and rejects new requests
  with 503 `shutting_down`.
- **Done.** `npm run check` passes; `node apps/api/dist/index.js` starts, `GET /health` returns `ok`, `SIGTERM` exits 0
  and leaves no `-wal` growth; restarting against the same file preserves data.
- **Advances.** FR-002 (R7), FR-006, FR-010, FR-011, AC-001, AC-005, AC-014.
- **Commit.** `feat(api): M6 config validation, health endpoint, graceful shutdown`

### P6 — Why M6 is offered as a *future* checkpoint (not why this session stops there)

**This session does not reach M6, or M0.** Per `docs/EXPERIMENT-BOUNDARY.md`'s GOV-004 protocol, the current
evaluator run stops as soon as the plan itself is approved and committed — before any product-code milestone begins.
The discussion below is guidance left for whichever session eventually implements this plan (after the recovery
experiment concludes), explaining why M6 is a good place *for that future session* to pause if it, in turn, wants a
natural mid-implementation checkpoint. It is not a description of this session's own stopping point.

At the end of M6, the repo would contain: the complete shared contract surface, a persisted schema with every
invariant enforced by the storage engine, a deterministic provider, all domain state transitions with both
idempotency keys, all non-streaming HTTP routes, a validated configuration surface, and a green `npm run check`.
Fourteen acceptance criteria (AC-001, 003–010, 014, 016, 017, 019, 021) would already have automated evidence, and
the remaining work would be three clean verticals — SSE (M7), client (M8–M10), evidence (M11–M12) — each specified
in `SPECS.md` and sequenced below. Nothing in M7–M12 requires a decision that was made only in conversation.

For a future implementing session that stops **before** M6, the same rule applies: stop at the end of whichever
milestone last completed and append `[DONE <sha>]` to its header; every milestone boundary is coherent by
construction (P0.1). Do not stop mid-milestone; if you must, revert the partial work rather than commit a repo that
fails `npm run check`.

---

## M7 — Stream coordination and the SSE endpoint

- **Goal.** `ResponseStreamHub`, cursor resolution, `GET /api/responses/:responseId/events`, live + replay from one
  log.
- **Dependencies.** M6.
- **Files.** `apps/api/src/stream/{responseStreamHub,sseWriter,cursor}.ts`; `apps/api/src/http/routes/responses.ts`
  (register R6); `apps/api/src/domain/responseRunner.ts` (publish post-commit); `apps/api/src/testing/sseClient.ts`;
  tests `stream/{responseStreamHub,cursor,sseWriter,replay}.test.ts`, `http/routes/responses.test.ts` (extend).
- **Tests to write.** cold connect to a completed response replays the whole log in order and closes after the
  terminal event; connect with `Last-Event-ID = k` yields only `> k`, with no repeated delta text (**AC-011**); the
  four cursor cases with their distinct codes, both via header and via `?lastEventId` (**AC-012**); header wins over
  query when both are present (**[A2]**); two concurrent subscribers to one response receive identical frame
  sequences; a subscriber to response A never receives an event of response B; events appended during the drain window
  are delivered exactly once (drive it by appending between two drain pages); buffer overflow forces a re-drain and
  still yields no gap and no duplicate; heartbeat comment lines carry no `id:` and do not move the cursor; a terminal
  event ends the response and disposes the channel (`hub.size === 0`).
- **Done.** `npm run check` passes; with a manually started server, `curl -N` on a live response streams deltas and
  closes, and re-`curl` with `-H "Last-Event-ID: n"` replays only the tail.
- **Advances.** FR-004, FR-005, AC-010, AC-011, AC-012.
- **Commit.** `feat(api): M7 ResponseStreamHub, SSE endpoint, Last-Event-ID replay`

## M8 — Web foundation: API client, reducer, URL hook

- **Goal.** All browser logic that is pure or side-effect-isolated, testable without rendering.
- **Dependencies.** M7 (contract-shaped responses to type against; M1 alone is enough to *write* it, but tests assert
  against real server shapes).
- **Files.** `apps/web/src/config.ts`, `api/{client,streamUrl}.ts`, `state/{types,conversationReducer}.ts`,
  `hooks/useUrlConversationId.ts`, `testing/{fakeFetch,fakeEventSource}.ts`; tests
  `state/conversationReducer.test.ts`, `api/client.test.ts`, `hooks/useUrlConversationId.test.tsx`.
- **Tests to write.** reducer: replay (`id <= last`) is a no-op on the exact state object; `id === last + 1` applies;
  `id > last + 1` sets `reconnecting` and leaves the cursor untouched; `response.completed` **replaces** text rather
  than appending, so a doubly-applied delta cannot survive the terminal event; `detail_loaded` seeds the cursor from
  `activeResponse.lastEventId`; `retry_accepted` resets text and cursor. Client: error bodies become `ApiError` with
  the stable code; a non-envelope error body degrades to `internal_error`; success bodies are schema-parsed.
- **Done.** `npm run check` passes; reducer tests run in the default (node) environment.
- **Advances.** FR-007, AC-004, AC-013 (logic half).
- **Commit.** `feat(web): M8 typed API client, idempotent conversation reducer, URL-backed selection`

## M9 — Web UI and stream hook

- **Goal.** The visible application: list, thread, composer, status region, one `EventSource` per response.
- **Dependencies.** M8.
- **Files.** `apps/web/src/main.tsx` (replace the seed placeholder), `App.tsx`, `app.css`,
  `hooks/{useConversationList,useConversation,useResponseStream}.ts`,
  `components/{ConversationList,ConversationThread,MessageItem,Composer,StatusRegion}.tsx`.
- **Done.** `npm run check` passes; manually: `npm run dev -w @rosetta-poc/chat-web` against a running API creates a
  conversation, sends a message, renders ordered deltas, ends on the completed assistant message; a mid-stream refresh
  resumes without duplicated text; a failing run (injected via a locally started server using
  `failingProvider`) shows the retry affordance and one retry completes. Record these in the experiment log.
- **Advances.** FR-001, FR-007, FR-008, AC-002, AC-013, AC-018.
- **Commit.** `feat(web): M9 conversation UI, composer, accessible status, response stream hook`

## M10 — Component tests and interface evidence

- **Goal.** Automated browser-side evidence for the criteria that are only observable in the DOM.
- **Dependencies.** M9.
- **Files.** `apps/web/src/testing/renderApp.tsx`; tests `App.test.tsx`,
  `components/{MessageItem,Composer,StatusRegion,ConversationList}.test.tsx`,
  `hooks/{useConversation,useResponseStream}.test.tsx`. Every file: `// @vitest-environment jsdom`.
- **Tests to write.** create → select → send → ordered deltas → completed assistant message (**AC-002**); refresh
  simulated by remounting with a seeded `activeResponse.lastEventId`, asserting no duplicate delta text (**AC-013**);
  the four failure kinds produce distinguishable accessible states each with a next action (**AC-018**); a message
  whose content is `<img src=x onerror=alert(1)>` appears as literal text, `document.querySelector("img")` is null,
  and a repo grep for `dangerouslySetInnerHTML` is empty (**AC-020**); a keyboard-only path (`user-event` with
  `tab`/`Enter`/`Space` only, no `click` on non-focused elements) performs create, select, send, observe status, retry
  (**AC-022**); live region announces transitions and never delta text.
- **Done.** `npm run check` passes with the component suite green; node-side tests still run in the default
  environment.
- **Advances.** AC-002, AC-013, AC-018, AC-020, AC-022, AC-024.
- **Commit.** `test(web): M10 component coverage for streaming, refresh, failure, a11y, escaping`

## M11 — Cross-cutting hardening

- **Goal.** The criteria that span layers: CORS, log/error redaction, restart recovery through the HTTP surface.
- **Dependencies.** M10.
- **Files.** `apps/api/src/http/{cors.test.ts,requestContext.test.ts}`,
  `apps/api/src/persistence/restart.test.ts` (extend to the HTTP level), `apps/api/src/http/errorHandler.test.ts`
  (extend), plus any small fixes those tests expose.
- **Tests to write.** a request from the configured origin is allowed and any other origin is refused, with no
  wildcard in the response headers (**AC-023**); structured log lines contain `contentCodePoints` and never `content`,
  `partial_text`, delta text, SQL, or an absolute path (FR-011); an interrupted non-terminal response, after restart,
  is exposed through `GET /api/conversations/:id` as a failed-and-retryable `activeResponse` rather than silently
  completed (**AC-014** at the API level); a 500 path returns the envelope with `internal_error` and nothing else
  (**AC-021**).
- **Done.** `npm run check` passes; `grep -rn "dangerouslySetInnerHTML\|: any\b" apps packages --include=*.ts
  --include=*.tsx` returns nothing in product code.
- **Advances.** FR-010, FR-011, AC-014, AC-021, AC-023, AC-024.
- **Commit.** `test(api): M11 CORS allowlist, log redaction, restart recovery, error envelope safety`

## M12 — Traceability, documentation, assumption closure

- **Goal.** The evidence artifacts the acceptance criteria themselves require.
- **Dependencies.** M11.
- **Files.** a review/evidence artifact mapping every FR and AC to implementation file + test name (**AC-025**), built
  from `SPECS.md` → `S11`; the experiment log entry listing every missed requirement, manual correction, unexpected
  change, and deferred item (**AC-026**); `docs/ASSUMPTIONS.md` — mark **[A1]**, **[A2]**, and the configuration-surface
  entry RESOLVED and move the facts to `docs/ARCHITECTURE.md` → stream coordination / boundaries (`S11.3`);
  `docs/CODEMAP.md` and `docs/DEPENDENCIES.md` regenerated; `docs/PATTERNS/` re-extracted now that functional code
  exists; `docs/TODO.md` — delete the entries M0/M6/M12 closed.
- **Note.** `docs/ARCHITECTURE.md` is on the do-not-modify list for the *planning* phases; the M12 edits are the
  assumption-resolution targets those `docs/ASSUMPTIONS.md` entries name explicitly, so they require human
  confirmation before landing.
- **Done.** `npm ci && npm run check` from a clean checkout under Node 24.21.0 (**AC-001**); every AC-001..AC-026 row
  marked passed with an evidence location, or explicitly failed with an explanation
  (`docs/ACCEPTANCE-CRITERIA.md` → Completion rule).
- **Advances.** AC-001, AC-015, AC-024, AC-025, AC-026.
- **Commit.** `docs: M12 requirement-to-evidence traceability, assumption closure, generated docs refresh`

## P7 — Milestone dependency graph

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6 ══STOP══► M7 ──► M8 ──► M9 ──► M10 ──► M11 ──► M12
                │                                        ▲       │
                └────────────── (M1 alone unblocks M8) ───┴───────┘
```
M8 could technically start after M1, since the client depends only on contracts. It is sequenced after M7 anyway:
writing the client against a *running* SSE endpoint is what makes M9's manual checks meaningful, and a fresh session
should not hold two unfinished verticals at once.

## P8 — Definition of done, per milestone (checklist a resuming session can apply mechanically)

1. `npm run check` passes.
2. Every test named in the milestone's "Tests to write" exists and is green.
3. No `any`, no `dangerouslySetInnerHTML`, no `ORDER BY` on a timestamp, no `await` inside `withTransaction`.
4. New files match `SPECS.md` → `S1` paths exactly; a deliberate deviation is edited into `S1` in the same commit.
5. The milestone header in this file gains `[DONE <sha>]`.
6. Anything deferred, corrected, or surprising goes into the experiment log (AC-026) — not into conversation only.
