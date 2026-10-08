# chat-poc — Execution Plan (HOW)

Status: implementation in progress on `experiment/EXP-002`; INC-00 through INC-10 are independently validated and published. INC-11 (API integration + SQLite/restart tests) has passed independent review, 364 tests/28 files, typecheck and build, and is ready for its publication checkpoint. INC-12 starts only after that checkpoint is pushed and remote-verified. Publication checkpoints are recorded in the independent evaluation repository. Ordered increments only. Contracts live in `plans/chat-poc/chat-poc-SPECS.md` and are referenced by section heading, never restated.
15 increments: `INC-00` … `INC-14`. `INC-00`..`INC-09` are Phase 7 (implementation), `INC-10`..`INC-13` are Phase 11 (tests), `INC-14` is evidence close-out.

## Read first (every increment)

| Document | Role |
|---|---|
| `plans/chat-poc/chat-poc-SPECS.md` | the only contract source for this work — §2 has the approved layout + the 6 key mechanisms; do not re-decide |
| `docs/REQUIREMENTS.md`, `docs/ACCEPTANCE-CRITERIA.md`, `docs/EXPERIMENT-BOUNDARY.md` | fixed, read-only; never edit, never weaken |
| `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md` | living context; update only as INC-14 says |
| `docs/PATTERNS/composite-package-tsconfig.md`, `workspace-script-fanout.md` | the config shapes INC-00 modifies |

## Governing rules

1. Layout and module names are fixed — `chat-poc-SPECS.md` §2.1 "Recommended layout". Adding or renaming a module needs orchestrator approval.
2. Every contract detail comes from a named SPECS section. If a detail is missing, stop and ask; do not invent it.
3. No `any`, no `as unknown as`, no `@ts-expect-error` in product code — `docs/REQUIREMENTS.md` quality requirements.
4. `docs/REQUIREMENTS.md#fixed-technology-boundary` — no new dependency; SPECS §12 is the complete allowed list.
5. Requirement IDs are referenced in code only as comments, at the element that satisfies them (`requirements-use`).
6. Tests are colocated `*.test.ts(x)`; temp DB + injected clock/ids wherever output stability matters — SPECS §10.
7. `apps/web` never imports `apps/api`; `domain/*` and `domain-rules/*` import nothing — SPECS §2.
8. Every increment ends green on its own exit check. A red exit check blocks the next increment.
9. Every command, install, build, and test runs under exactly Node `24.21.0`; a different active Node version is a blocked preflight, not an acceptable substitution.
10. Pin the runtime PATH in each runtime command, including child-process launches; verify npm `11.6.2`. Capture the actual command exit status without masking pipelines, retain failed runs and corrections, and map each named test to its criterion and committed test path. The 271 tests accepted at INC-10 must continue to pass; report additions separately and explain any changed or removed assertion.
11. Synchronize asynchronous integration tests with explicit provider/test signals and terminal status; use controlled timers where appropriate, not arbitrary sleeps as proof of completion. Validate fixtures independently of the implementation. Use `try/finally` or test teardown to settle owned work, close containers/connections, restore timers and remove only the test's own disposable files, including on failure.

Outcomes, findings and deviations are recorded in `docs/experiment/EXPERIMENT-LOG.md`; FR/AC evidence is recorded in `docs/experiment/EVIDENCE-MAP.md`. Both were created during planning and are finalized/updated in INC-14. Phase status stays in the orchestrator's ephemeral workflow state.

---

## Increment sequence

### INC-00 — Seed toolchain fixes (must land first)

Why first: every later increment's exit check runs `npm run typecheck`/`npm test`, and both are broken by the seed the moment api/web import shared. No product code in this increment.

- Files: `apps/api/tsconfig.json`, `apps/web/tsconfig.json`, `packages/shared/tsconfig.json`, new `tsconfig.test.json`, root `package.json`, `apps/api/package.json`, `apps/web/package.json`, `packages/shared/package.json`, root `vitest.config.ts`, new `apps/web/test/setup.ts`, delete `.prettierignore` (already staged).
- Spec: §8.1 Build order, §8.2 Test files out of `dist`, §8.3 Vitest projects.
- Covers: AC-001; unblocks AC-024.
- Exit: on a clean tree, `npm ci && npm run check` passes with zero tests present (`--passWithNoTests`); `ls apps/api/dist` shows no `*.test.js`; a throwaway `apps/web/src/smoke.test.tsx` rendering `<div/>` passes and is then deleted.
- Trap: the root `build`/`typecheck` scripts stop using `--workspaces` fan-out. Leaving the fan-out in place *and* adding `tsc -b` double-builds and can mask ordering bugs.

### INC-01 — Shared contracts + domain rules

- Files: `packages/shared/src/` → `index.ts` (barrel), `ids.ts`, `contracts/{conversation,message,response,events,errors,params,health}.ts`, `domain-rules/{normalize,title,terminal}.ts`.
- Spec: §2.1, §3.1, §3.3, §4.1, §4.2, §4.3 (schemas only — all 5 explicitly named request/response bodies plus the 3 inline/unnamed response bodies conversation.ts must also cover per §2.1 "create/list bodies": create response, list response, get-detail response), §4.6, §6.2, §6.3.
- Covers: FR-010, AC-004, AC-012 (parser), AC-019 (limits), A-008/A-010 finalized values, `contracts/health.ts` (execution-discovered specification correction, 2026-09-27 — see EXPERIMENT-LOG), `createConversationResponseSchema`/`listConversationsResponseSchema`/`getConversationResponseSchema` (named wrappers for §4.3's unnamed inline response shapes, 2026-09-27 — see EXPERIMENT-LOG).
- Exit: `npm run typecheck`; `node -e "import('@rosetta-poc/chat-shared').then(m=>console.log(Object.keys(m).length))"` after `npm run build -w @rosetta-poc/chat-shared` prints a non-zero count.
- Trap: `packages/shared` stays TSX-free and zod-only — no Node built-ins, no DOM types, so both api and web can consume it.

### INC-02 — API config, domain types/errors, pure domain modules, ports

- Files: `apps/api/src/config/env.ts`, `domain/{types,errors,response-machine,idempotency,retry}.ts`, `ports.ts`.
- Spec: §2 (ports), §3.2, §3.4, §7.1.
- Covers: FR-009, FR-010 (env), AC-008, AC-009, AC-010 (transition/append rules), A-007 finalized values, A-003, §3.4a one-active-response gate (user-directed correction 2026-09-27).
- Exit: under the pinned Node version, `npm run typecheck`; a pure-domain smoke covers all 16 response-status transition pairs, first/duplicate-start and terminal append guards, idempotency, retry, and the active-response gate. `domain/*` files contain no `import` of zod, `node:*`, or any sibling layer — verified by grep.
- Corrections discovered during execution: keep Node ambient types in `apps/api/tsconfig.json` rather than a file-local triple-slash directive; reject a duplicate `response.started` explicitly so the guard matches §6.2's exactly-one-start invariant. Both are part of the INC-02 checkpoint even though the tsconfig line corrects INC-00 ownership.

### INC-03 — Persistence

- Files: `apps/api/src/persistence/{db,schema,unit-of-work,row-contracts,conversation-repo,message-repo,response-repo,event-repo}.ts`.
- Spec: §5.1, §5.2, §5.3, §5.4; ordering contract in §5.2.
- Covers: FR-006, FR-010 (row re-validation), AC-005, AC-007, AC-010 (terminal index), AC-008/AC-009 (idempotency index), AC-017 (retry index).
- Exit: `npm run typecheck`; a throwaway script opens a temp DB, applies the schema twice (idempotence), inserts two conversations with an identical `Clock` value and asserts `listSummaries()` order is stable, then asserts the second insert of a duplicate `(conversation_id, client_message_id)` and of a second terminal event both throw. Script is deleted afterwards.
- Trap: no `await` anywhere inside `UnitOfWork.run` — that absence is what makes SPECS §5.5 atomicity and §6.4 `STREAM-INV-1` hold. `lastInsertRowid` is never read (SPECS §5.1).
- Corrections discovered during execution: the §2.2 dependency rule now explicitly permits the persistence adapter to import pure domain guards/errors/types and shared/Zod row schemas, because §5.3–§5.4 require those imports. This resolves an internal specification contradiction without widening the adapter outward toward IO or transport code.

### INC-04 — Provider + stream coordination

- Files: `apps/api/src/provider/{types,deterministic-provider}.ts`, `stream/{hub,runner,subscribe,recovery}.ts`, `testing/provider-doubles.ts`.
- Spec: §2.2, §3.5, §5.6, §6.2, §6.4 (§2.2 "Key mechanisms" for persist-then-emit and `STREAM-INV-1`).
- Covers: FR-003, FR-004, FR-005 (replay), FR-008 (failure path), AC-003, AC-010, AC-011, AC-014, AC-016, A-002.
- Exit: `npm run typecheck`; a throwaway script drives `runner` against a temp DB with `fakeClock`+`sequentialIds` and prints the `stream_events` rows — asserts seq 1..n, one `response.started`, one terminal, and that two runs over the same normalized content produce identical `data` strings.
- Trap: `subscribe.ts` steps 1–5 must sit in one synchronous block. Inserting an `await`, a `queueMicrotask`, or a `Promise.resolve().then` between them reintroduces the replay/live gap the design eliminates.
- Correction discovered during execution: once the buffering subscription is installed, a synchronous backfill/read or sink/write failure must unsubscribe before it is rethrown. Independent review found and fixed the otherwise-leaked subscriber; INC-12 carries the regression test.

### INC-05 — Use cases

- Files: `apps/api/src/usecases/{create-conversation,list-conversations,get-conversation,send-message,retry-response}.ts`.
- Spec: §3.4a, §4.3 (payload composition), §4.4, §4.5, §5.5.
- Covers: FR-002 (behaviour), FR-008, FR-009, AC-006, AC-008, AC-009, AC-017, one-active-response gate (user-directed correction 2026-09-27).
- Exit: `npm run typecheck`; a throwaway script runs `send-message` twice with the same key and same content (asserts identical IDs, full `userMessage`/`response` objects returned, provider `runCount === 1`), then with the same key and different content (asserts a thrown conflict and zero new rows), then with a different key while the first response is still `pending` (asserts `RESPONSE_ALREADY_ACTIVE` and zero new rows), then re-sends the **original** key again while that same response is still active (asserts it still succeeds identically). It also retries a failed response while a different response in that conversation is active (asserts `RESPONSE_ALREADY_ACTIVE`, zero writes, and no raw SQLite error), while a repeated retry of its own active replacement still returns that replacement.
- Trap: the provider run starts **after** the transaction commits, and the HTTP handler does not await it (SPECS §5.5). Apply the active-response gate only after `classifySend` resolves to `new` or `classifyRetry` resolves to `start`; checking earlier would incorrectly block an idempotent replay of the active send or retry.
- Correction discovered during execution: the original retry path relied on the database's one-active-response index when another response in the conversation was active, surfacing an internal SQLite error. The application gate now runs after `classifyRetry === start`, while `existing` replay returns before it; SPECS §3.4a/§4.3/§4.5/§4.6 and INC-11 carry the corrected contract and regression case.

### INC-06 — HTTP/SSE transport

- Files: `apps/api/src/http/{server,error-envelope,logging,sse}.ts`, `http/routes/{health,conversations,messages,responses,response-events}.ts`.
- Spec: §4.3, §4.6, §6.1, §6.3, §7.3, §7.4.
- Covers: FR-002, FR-004 (framing), FR-005 (header handling), FR-010 (CORS, boundary validation), AC-004, AC-012, AC-021, AC-023.
- Exit: `npm run typecheck`; `curl -i` against a locally started server returns the exact status codes of SPECS §4.3 for: create, list, get, send, retry-of-completed, unknown id, non-UUID id; `curl -N -H 'Last-Event-ID: 0'` on a completed response prints the full frame sequence in SPECS §6.1 format.
- Trap: both `Last-Event-ID` 400s are written as a normal JSON envelope **before** any SSE header. Emitting SSE headers first makes the error invisible to the client.
- Corrections/findings discovered during execution: the fixed Zod `issue.code` message map required by SPECS §4.6 was absent from INC-01's shared error contract and was added during INC-06; the route layer now consumes it without echoing received values. The guided live-server probe required three harness-only corrections (zsh bracket globbing, BSD `cat` flags, and attaching the disconnect observer before abort); none changed product code. Independent verification then passed the full gate plus a separate 27-group HTTP/CORS/SSE/redaction probe. Fastify's default startup message can still embed the configured host/port in the free-text `msg`, so INC-07 must suppress it rather than relying on the structured-field formatter.

### INC-07 — Bootstrap, shutdown, entrypoint, test helpers

- Files: `apps/api/src/bootstrap/{container,shutdown}.ts`, `apps/api/src/index.ts`, `apps/api/src/testing/{temp-db,fake-clock,sequential-ids}.ts`.
- Spec: §2 (composition root), §5.6 (recovery before `listen`, both zero-event and partial-stream branches), §7.4 (startup-log suppression and direct-bind rationale), §7.5 (registry + bounded-drain shutdown), §10 (helper contracts), §12 (`node:os` for the temp-DB root only).
- Covers: FR-011, AC-014 (wiring), AC-021 (log allowlist in practice), AC-005 (re-open same file), bounded-drain shutdown (user-directed correction 2026-09-27; automated test lands in INC-11).
- Exit: `npm run dev:api` starts, emits an allowlisted `recoveredResponses` record without a framework-generated `Server listening at ...`/host/port message, and serves `/health` `200`; `SIGINT` closes within 5 s with exit code 0 and no `ERR_SQLITE_*` on stderr both normally and while one idle keep-alive connection is held open; restarting against the same `CHAT_DB_PATH` preserves prior data and reports a non-zero `recoveredResponses` when a response was left active (manual smokes only — automated shutdown assertions land in INC-11's `bootstrap/shutdown.test.ts`).
- Trap: `createContainer(config, overrides?)` is the only injection seam — no env var may select a provider (SPECS §7.1). The runner registry must store `{controller, promise}` pairs, not bare controllers — awaiting only the abort call without awaiting the runner's settle promise is exactly the bug SPECS §7.5 step 4 exists to prevent. Do not call Fastify `listen` with its default successful-listen logging enabled: the text message includes configured host/port and bypasses structured-field filtering, violating the exhaustive §7.4 allowlist. The accepted direct `app.server.listen(...)` bind deliberately relies on Node 19+ `server.close()` idle-connection behavior and the pinned Node `24.21.0`; any Node/Fastify version change must re-run the keep-alive shutdown regression and re-evaluate this trade-off.

### INC-08 — Web foundation: config, API client, SSE client, reducer

- Files: `apps/web/src/config/env.ts`, `api/{http-client,sse-client}.ts`, `state/{ui-status,chat-reducer}.ts`; plus the `vite/client` `types` entry in `apps/web/tsconfig.json` and `tsconfig.test.json` (approved scope extension, see corrections below).
- Spec: §6.5, §7.2, §8.2, §9.1, §9.2, §9.3, §9.4.
- Covers: FR-005 (client side), FR-007, FR-010 (env), AC-004, AC-013, AC-018 (vocabulary).
- Exit: `npm run typecheck`. Grep proves `EventSource` appears nowhere in `apps/web`. `chat-reducer.ts` imports no `react`, no `fetch`, no `Date`.
- Trap: the two seeding branches of SPECS §9.4 rule 6 are the AC-013 duplication bug. An active response seeds empty text and replays from 0; a terminal one seeds text and never opens a stream.
- Corrections discovered during execution: `config/env.ts` reads `import.meta.env` (SPECS §7.2), but neither `apps/web/tsconfig.json` nor `tsconfig.test.json` loaded Vite's client types, so it could not typecheck. By evaluator decision, both files gained `vite/client` in `types` (`tsconfig.test.json` keeps `node`); both are therefore in INC-08's approved scope even though INC-00 otherwise owns all tsconfig files. INC-09 note: rule 6 re-seeds every response on `conversation/loaded`, so the hook must not reload a conversation whose response stream is open, or must reopen that stream from 0 afterwards.

### INC-09 — Web orchestration and components

- Files: `apps/web/src/state/ChatProvider.tsx`, `hooks/{useSelectedConversation,useResponseStream}.ts`, `components/{App,ConversationList,MessageList,MessageComposer,StatusAnnouncer,RetryButton}.tsx`, `apps/web/src/main.tsx`, `apps/web/index.html` (title, plus a minimal `data:` favicon link — narrow scope deviation, see findings).
- Spec: §9.5, §9.6, §6.5 (reconnect policy).
- Covers: FR-001, FR-007, FR-008 (retry affordance), AC-002, AC-018, AC-020, AC-022.
- Exit: `npm run dev:web` + `npm run dev:api`; manual smoke with pointer disabled (keyboard only): create → select → send → watch deltas → completed; then refresh mid-stream and confirm the conversation and the response resume with no duplicated text; then run with `failingProvider` wired through a temp container and confirm a visible failure plus a working Retry. Browser console shows zero errors and zero CORS warnings.
- Trap: no `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML` anywhere (SPECS §9.6); the `.sr-only` class uses clip/offset, not `display:none`.
- Findings discovered during execution: (1) the §9.6 tab order (… textarea → Send → Retry) requires the composer to precede the message list in the DOM, since Retry lives on the failed response in the list; it is also placed first visually, so no CSS reordering splits visual order from reading order. (2) No stylesheet file is in scope and `index.html` may change only its title, so `App` renders the `.sr-only` rules as a `<style>` text child. (3) The INC-08 note is honored: a conversation loads only on a selection change, tracked synchronously so React StrictMode's double mount cannot load it twice. (4) Browser automation was unavailable in the session, so the manual in-browser keyboard smoke and console check were replaced by a jsdom keyboard-only smoke of the real app plus real `dev:web`/API servers; the literal in-browser pass remains for independent review. (5) Independent real-browser review found that a delayed send error from an old conversation, released after a new conversation was created, was shown in the new one. Every selection change (select, NOT_FOUND deselect, create) now bumps a selection generation, and send/retry/load results are dispatched only while the generation is unchanged, which also rejects A → B → A. Retained network-failure send keys are scoped per conversation. (6) The same review saw `favicon.ico` return 404, so `index.html` gained `<link rel="icon" href="data:," />`. This is a narrow deviation from its title-only scope, adds no asset file, and changes no behaviour.

### INC-10 — Tests: unit layer

- Files: `packages/shared/src/**/*.test.ts` (contracts, normalize, title, terminal, params), `apps/api/src/domain/*.test.ts`, `apps/api/src/http/error-envelope.test.ts`, `apps/api/src/provider/deterministic-provider.test.ts`, `apps/api/src/http/logging.test.ts`, `apps/web/src/state/chat-reducer.test.ts`, `apps/web/src/api/sse-client.test.ts`.
- Spec: §10 (test data), §3.1, §3.2, §3.4, §3.5, §4.6, §6.3, §7.4, §9.4.
- Named unit evidence contributing to ACs (integration obligations remain): `deterministic-provider.test.ts` "identical normalized input ⇒ byte-identical payloads" (AC-003); `params.test.ts` five-row table (AC-012); `normalize.test.ts` whitespace-only / 4000 / 4001 / surrogate-pair cases (AC-019); `error-envelope.test.ts` four redaction fixtures (AC-021); `logging.test.ts` content-absence assertion (AC-021); `chat-reducer.test.ts` "replayed seq ≤ lastAppliedEventId returns the same state reference" (AC-013).
- Coverage limitation carried to INC-14: throwing `onEvent` consumer callbacks are excluded from the committed SSE unit suite. INC-08 live validation is separate evidence; do not claim complete automated callback-error coverage. An isolated subprocess test may close this gap if justified, with its result recorded explicitly.
- Exit: `npm test` green; both Vitest projects report a non-zero file count.

### INC-11 — Tests: API integration + SQLite/restart

- Files: `apps/api/src/http/routes/*.test.ts`, `apps/api/src/usecases/*.test.ts`, `apps/api/src/persistence/*.test.ts`, `apps/api/src/stream/recovery.test.ts`, `apps/api/src/bootstrap/shutdown.test.ts`.
- Spec: §3.4a, §4.3, §4.4, §4.5, §5.2, §5.5, §5.6, §7.3, §7.5, §10.
- Named tests: "injected fault leaves neither message nor response" (AC-006); "identical timestamps keep list and history order" (AC-007); "duplicate key returns original IDs, full `userMessage`/`response` objects, `runCount === 1`" (AC-008); "same key different content ⇒ 409 and zero stored change" (AC-009); "restart on the same file preserves all four tables" (AC-005); **"restart recovers a zero-event pending response to exactly `[response.started@1, response.failed@2]`, status `failed`"** and **"restart recovers a partial-stream response by appending exactly one `response.failed` at `maxSeq+1`, prior events and `partial_text` untouched"** — both replacing the single AC-014 test (user-directed correction 2026-09-27); "failing provider persists one failure event and keeps the user message + partial" (AC-016); "second retry returns the same replacement, one user message" (AC-017); **"sending while the conversation has an active response returns `409 RESPONSE_ALREADY_ACTIVE` with zero writes; re-sending the original active response's own `clientMessageId` still returns `202` with the original IDs"** (user-directed correction 2026-09-27); **"retrying a failed response while a different response in the conversation is active returns `409 RESPONSE_ALREADY_ACTIVE` with zero writes, while replaying an existing active retry still returns `202` with that replacement"** (execution-discovered correction, INC-05); **"`shutdown()` with a slow-but-not-hung provider run in flight aborts it, awaits its settle within `SHUTDOWN_TIMEOUT_MS`, then closes the DB with no `ERR_SQLITE_*`/unhandled rejection, and the aborted response ends up `failed`"** (user-directed correction 2026-09-27); **"`shutdown()` while an idle HTTP keep-alive connection is open closes that connection and exits inside the bound with code 0"** (execution-discovered regression, INC-07; pinned Node 24.21.0); "foreign origin gets no `access-control-allow-origin`, configured origin does" (AC-023); the §10 error-category table (AC-019).
- Explicit §10 determinism case: in `apps/api/src/usecases/send-message.test.ts`, send the same normalized content through two independent containers, with separate fresh databases and identically initialized injected clocks and ID sequences. Wait for both terminal states, require a non-empty complete event sequence, and compare every persisted event's serialized `data` byte-for-byte (AC-003). Provider-chunk equality from INC-10 alone does not satisfy this case.
- Restart/shutdown evidence: exercise an actual child-process stop and restart against the same disposable database file, as well as the two seeded recovery branches above. Use the real entrypoint and loopback idle keep-alive connection for bounded process-exit evidence; reconstructing a container alone does not establish process shutdown. Keep deterministic container assertions separate from real-clock process bounds and identify each in the evidence.
- Exit: `npm test` green, including the existing 271 tests; integration tests use isolated databases, with `fakeClock`+`sequentialIds` wherever stable output is asserted. Record named cases, actual exits, failures/corrections and cleanup outcomes for independent review.

### INC-12 — Tests: SSE replay

- Files: `apps/api/src/stream/{hub,runner,subscribe}.test.ts`, `apps/api/src/http/routes/response-events.test.ts`, `apps/api/src/http/sse.test.ts`.
- Spec: §6.1, §6.2, §6.3, §6.4.
- Named tests: "seq 1..n, one start, one terminal, nothing after terminal" (AC-010); "reconnect at mid-stream replays only later events, concatenated deltas contain no repeat, then continues live" (AC-011); "reconnect on a terminal response replays then closes"; "`Last-Event-ID === maxSeq` on a terminal response closes with zero frames"; "synchronous backfill/read or sink/write failure detaches the buffering subscriber before rethrow"; the five §6.3 rows over the real route (AC-012); "a stream for response A never yields a frame for response B" (FR-005); "heartbeat frames carry no `id:`" (AC-003/AC-010).
- Exit: `npm test` green.

### INC-13 — Tests: React component

- Files: `apps/web/src/components/*.test.tsx`, `apps/web/src/state/ChatProvider.test.tsx`, `apps/web/src/hooks/useResponseStream.test.ts`.
- Spec: §6.5, §9.2, §9.3, §9.6, §10.
- INC-09 review carry-forward: commit regression tests for delayed send/retry errors after selection changes; stale send/load callbacks across A → B → A; unchanged draft/sending state in the newly selected conversation; conversation-scoped retained send keys (reuse within A, fresh key for the same text in B); and StrictMode/URL selection without duplicate loads or response reseeding. Temporary probes are evidence only, not substitutes for these tests. Wait for terminal status before beginning a next send; full-looking delta text is not completion. Cover the §6.5 bounded reconnect/backoff policy and cancellation on selection/unmount in the hook tests.
- Named tests: "create → send → ordered deltas → completed message" (AC-002); "refresh mid-stream restores selection from `?c=` and resumes without duplicate messages or deltas" (AC-013); "network / API error / validation error / provider failure each produce a distinct announced state with one usable next action" (AC-018); "`<img src=x onerror=…>` renders as text, `querySelector('img')` is null" (AC-020); "keyboard-only create → select → send → observe status → retry" with `user-event` `tab()`/`keyboard()` only (AC-022); "retry click issues one retry request and does not duplicate the user message" (FR-008).
- Exit: `npm test` green; `fetch` is stubbed in every test, no real network, no `EventSource` polyfill.

### INC-14 — Evidence, docs, close-out (runs alone)

- Files: finalize/update existing `docs/experiment/EVIDENCE-MAP.md` and `docs/experiment/EXPERIMENT-LOG.md`; edits to `docs/ARCHITECTURE.md` (Installed sections, A-007/A-011/A-012/A-013 facts), `docs/ASSUMPTIONS.md` (mark A-007/A-009/A-011/A-012/A-013 RESOLVED), `docs/CODEMAP.md`, `docs/TECHSTACK.md`, `docs/PATTERNS/*` if a new pattern emerged, `agents/IMPLEMENTATION.md`, `docs/TODO.md`.
- Spec: §13.
- Covers: AC-025, AC-026, and the AC-015 obligation stated in §13.
- Exit: in a separate disposable fresh clone/worktree created from the completed commit, run `npm ci && npm run check` under Node `24.21.0`; never clean the working checkout. `EVIDENCE-MAP.md` has a row for all 11 FRs and all 26 ACs with an implementation path and a test path; `EXPERIMENT-LOG.md` records every deviation, manual correction and deferral from INC-00..INC-13.
- Must run alone: it touches shared living docs that every other increment may also want to read.
- Preserve the INC-10 callback-error limitation unless later committed evidence closes it; distinguish unit, container-integration, real-process and manual observations in the final evidence map.

---

## File ownership and parallelism

Ownership is by directory, so no two concurrent increments write the same file.

| Owner | Paths |
|---|---|
| INC-00 | all `tsconfig*.json`, all `package.json`, `vitest.config.ts`, `apps/web/test/**` |
| INC-01 | `packages/shared/src/**` (non-test) |
| INC-02 | `apps/api/src/{config,domain}/**`, `apps/api/src/ports.ts` |
| INC-03 | `apps/api/src/persistence/**` |
| INC-04 | `apps/api/src/{provider,stream}/**`, `apps/api/src/testing/provider-doubles.ts` |
| INC-05 | `apps/api/src/usecases/**` |
| INC-06 | `apps/api/src/http/**` |
| INC-07 | `apps/api/src/bootstrap/**`, `apps/api/src/index.ts`, rest of `apps/api/src/testing/**` |
| INC-08 | `apps/web/src/{config,api}/**`, `apps/web/src/state/{ui-status,chat-reducer}.ts`; the `vite/client` `types` entry in `apps/web/tsconfig.json` and `tsconfig.test.json` (execution-discovered, evaluator-approved) |
| INC-09 | `apps/web/src/{components,hooks}/**`, `state/ChatProvider.tsx`, `main.tsx`, `index.html` |
| INC-10 | `packages/shared/src/**/*.test.ts`, `apps/api/src/{domain,provider}/*.test.ts`, `apps/api/src/http/{error-envelope,logging}.test.ts`, `apps/web/src/{state/chat-reducer,api/sse-client}.test.ts` |
| INC-11 | `apps/api/src/{http/routes,usecases,persistence}/*.test.ts`, `apps/api/src/stream/recovery.test.ts`, `apps/api/src/bootstrap/shutdown.test.ts` |
| INC-12 | `apps/api/src/stream/{hub,runner,subscribe}.test.ts`, `apps/api/src/http/{sse,routes/response-events}.test.ts` |
| INC-13 | `apps/web/src/{components,hooks}/*.test.tsx`, `apps/web/src/state/ChatProvider.test.tsx` |
| INC-14 | `docs/**`, `agents/IMPLEMENTATION.md` |

Latent collisions resolved by the table above: `apps/api/src/testing/**` is split (INC-04 owns the provider doubles it needs; INC-07 owns the rest); `apps/api/src/stream/*.test.ts` is split so INC-11 owns only `recovery.test.ts` and INC-12 owns the other three; `apps/api/src/http/*.test.ts` is split so INC-10 owns the two pure unit tests and INC-12 owns the SSE ones; `apps/api/src/bootstrap/*` is split the same way — INC-07 owns `container.ts`/`shutdown.ts`, INC-11 owns `shutdown.test.ts`.

| # | Increment | Depends on | Parallel with |
|---|---|---|---|
| 00 | Seed toolchain fixes | — | none (runs alone) |
| 01 | Shared contracts + domain rules | 00 | none |
| 02 | API config/domain/ports | 01 | 08 |
| 03 | Persistence | 02 | 08 |
| 04 | Provider + stream | 03 | 08, 09 |
| 05 | Use cases | 04 | 08, 09 |
| 06 | HTTP/SSE transport | 05 | 08, 09 |
| 07 | Bootstrap + entrypoint | 06 | 08, 09 |
| 08 | Web foundation | 01 | 02–07 |
| 09 | Web orchestration + components | 08 | 04–07 |
| 10 | Tests: unit | 07, 09 | 11, 12, 13 |
| 11 | Tests: API integration + restart | 07 | 10, 12, 13 |
| 12 | Tests: SSE replay | 07 | 10, 11, 13 |
| 13 | Tests: component | 09 | 10, 11, 12 |
| 14 | Evidence + docs | 10–13 | none (runs alone) |

Pairs not listed as parallel are sequential. Parallelism is valid only because of the ownership table: the api chain (02→07) and the web chain (08→09) share no file after `packages/shared` has landed, and the four test increments write into four disjoint file sets. INC-00, INC-01 and INC-14 must each run alone — INC-00 and INC-14 rewrite shared config/docs, and INC-01 is the import boundary everything else depends on.

Sequencing hazards worth naming: nothing in `apps/api` or `apps/web` may be authored before INC-01 is built (`@rosetta-poc/chat-shared` resolves to `dist/`), and the parallel web chain must run `npm run build -w @rosetta-poc/chat-shared` once before its first typecheck.

---

## Coverage table — FR-001..FR-011, AC-001..AC-026

Spec sections are headings in `plans/chat-poc/chat-poc-SPECS.md`.

| ID | SPECS section | Plan increment(s) |
|---|---|---|
| FR-001 | §9.1, §9.3, §9.6 | INC-09, INC-13 |
| FR-002 | §4.3, §4.6 | INC-05, INC-06 |
| FR-003 | §3.5 | INC-04 |
| FR-004 | §3.2, §6.1, §6.2 | INC-04, INC-06 |
| FR-005 | §6.3, §6.4, §6.5 | INC-04, INC-06, INC-08 |
| FR-006 | §5.1, §5.2, §5.3, §5.5 | INC-03 |
| FR-007 | §9.3, §9.4, §9.5, §6.5 | INC-08, INC-09 |
| FR-008 | §3.4, §4.5, §5.6 | INC-04, INC-05, INC-09 |
| FR-009 | §3.4, §4.4, §5.5 | INC-02, INC-05 |
| FR-010 | §3.1, §4.1, §5.4, §7.1, §7.2, §7.3, §9.6 | INC-01, INC-02, INC-03, INC-06, INC-08 |
| FR-011 | §7.4, §7.5 | INC-07 |
| AC-001 | §8.1, §8.2, §8.3 | INC-00 (re-verified at INC-14 exit) |
| AC-002 | §9.3, §9.6 | INC-09, INC-13 |
| AC-003 | §3.5, §6.2, §10 | INC-04, INC-10, INC-11 |
| AC-004 | §4.1–§4.3, §4.6, §6.2 | INC-01, INC-06, INC-08 |
| AC-005 | §5.1, §5.2 | INC-03, INC-07, INC-11 |
| AC-006 | §5.5 | INC-05, INC-11 |
| AC-007 | §5.2 (ordering contract) | INC-03, INC-11 |
| AC-008 | §3.4, §4.4, §5.5 | INC-02, INC-05, INC-11 |
| AC-009 | §3.4, §4.4, §5.5 | INC-02, INC-05, INC-11 |
| AC-010 | §3.2, §5.2 (indexes), §6.2 | INC-02, INC-03, INC-04, INC-12 |
| AC-011 | §6.4 | INC-04, INC-12 |
| AC-012 | §6.3, §4.6 | INC-01, INC-06, INC-12 |
| AC-013 | §9.4 (rules 1, 3, 6), §6.5 | INC-08, INC-13 |
| AC-014 | §5.6 | INC-04, INC-07, INC-11 |
| AC-015 | §13 (out-of-product criterion) | INC-14 — **flagged below** |
| AC-016 | §3.5, §4.2, §5.6 | INC-04, INC-11 |
| AC-017 | §3.4, §4.5, §5.2 (`ux_responses_retry_of`) | INC-05, INC-11 |
| AC-018 | §9.1, §9.2, §9.6 | INC-08, INC-09, INC-13 |
| AC-019 | §3.1, §4.1, §10 | INC-01, INC-10, INC-11 |
| AC-020 | §9.6 (escaping) | INC-09, INC-13 |
| AC-021 | §4.6 (redaction), §7.4 | INC-06, INC-07, INC-10 |
| AC-022 | §9.6 (focus contract) | INC-09, INC-13 |
| AC-023 | §7.3 | INC-06, INC-11 |
| AC-024 | §10 | INC-10, INC-11, INC-12, INC-13 |
| AC-025 | §13 | INC-14 |
| AC-026 | §13 | INC-14 |

No cell is blank. One ID needs an explicit caveat:

**AC-015 — cannot be satisfied by product code, by design.** It measures whether a fresh Claude Code session can recover the implementation task from committed artifacts; that is the separate `GOV-004` run on its own branch, and `docs/CONTEXT.md` forbids copying artifacts between the two experiments. Proposed fix, already folded into INC-14: this plan's only obligation is that `EXP-002`'s committed artifacts (`docs/**`, `plans/chat-poc/**`, `agents/IMPLEMENTATION.md`) are self-sufficient enough for such a resume, and INC-14 records in `docs/experiment/EVIDENCE-MAP.md` that AC-015's evidence location is the `GOV-004` run rather than an `EXP-002` test. Nothing is silently dropped.
