# chat-poc — Tech Specs (WHAT)

Status: specification checkpoint reviewed; coding-flow Phase 6 is intentionally held before overall approval. Implementation has not started. Target state only. No process, no step order — that is `plans/chat-poc/chat-poc-PLAN.md`.
Authority: `docs/REQUIREMENTS.md` (FR-001..FR-011) + `docs/ACCEPTANCE-CRITERIA.md` (AC-001..AC-026) are fixed and read-only. Approved design: Option A Lean Hexagonal + 2 adoptions from Option C, carried into the self-contained §2 below. Living context: `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md`.
Every contract element below carries the FR-*/AC-* IDs it satisfies. FR/AC prose is never restated — only the resulting contract.

## TLDR

1. Layout, module names and mechanisms are fixed by this specification's approved §2 design; later sections fill in exact types, schemas, SQL, status codes, framing, env and UI contracts.
2. Contract surface = 7 files in `packages/shared/src/contracts/` + 3 in `domain-rules/`, consumed verbatim by api and web (AC-004).
3. Persistence = 4 tables + 7 indexes incl. partial unique terminal index, `(conversation_id, client_message_id)` unique index, and one-active-response-per-conversation unique index (AC-008/AC-009/AC-010, user-directed correction 2026-09-27).
4. 11 stable error codes, one envelope, fixed HTTP status per code; unknown errors collapse to `INTERNAL_ERROR` + fixed string (AC-021).
5. SSE: `id: <seq>` from 1 per response, 4 event types, payloads free of clock/random (AC-003/AC-010); heartbeat is a comment frame outside the id sequence.
6. `Last-Event-ID`: absent or empty ⇒ 0; non-`^\d{1,15}$` ⇒ 400 `INVALID_LAST_EVENT_ID`; `> maxSeq` ⇒ 400 `LAST_EVENT_ID_OUT_OF_RANGE` (AC-012, R4 finalized).
7. Uniform `202` for new send, duplicate send, retry-start and retry-replay (R5 finalized). `active` = `pending|streaming` (R6 finalized).
8. Title = 60 code points, no ellipsis, placeholder `"New conversation"` (A-010/R8 finalized).
9. Deferred items finalized: A-007 (5 API env vars + 1 web var, exact defaults), A-011 (`DatabaseSync`, app-generated IDs, WAL), A-012 (`tsc -b` + `references`), A-013 (two Vitest projects + explicit `afterEach(cleanup)`).
10. Web state = one pure reducer, `lastAppliedEventId` monotone guard, 6 UI statuses × 4 error kinds, two live regions (AC-013/AC-018/AC-022).

---

## 1. Scope

In scope: full target state of `packages/shared`, `apps/api`, `apps/web`, the seed toolchain fixes required by AC-001, and the test contracts of the five layers named by AC-024.
Out of scope of this spec: AC-015 (GOV-004 session-recovery experiment — a separate run, not product runtime; see §13), AC-025/AC-026 artifact *content* (locations fixed in §13, filled during the run).
Non-negotiable technology boundary is `docs/REQUIREMENTS.md#fixed-technology-boundary`; nothing below introduces a dependency absent from the seed manifests.

### 1.1 Finalized deferred decisions (authoritative values)

| Item | Decision |
|---|---|
| A-007 config surface | §7 — `CHAT_DB_PATH`, `CHAT_API_PORT`, `CHAT_API_HOST`, `CHAT_WEB_ORIGIN`, `CHAT_LOG_LEVEL`, `VITE_API_BASE_URL` |
| A-009 length after trim | Validation order = normalize → empty check → 4000-code-point check (§3.1) |
| A-011 `node:sqlite` pattern | §5.1 — `DatabaseSync`, one handle, WAL, app-generated IDs, explicit `BEGIN IMMEDIATE` |
| A-012 build order | §8.1 — `references` to shared + root `tsc -b` |
| A-013 component env | §8.3 — two Vitest projects, jsdom for `apps/web`, explicit `afterEach(cleanup)` |
| A-014 lint/format | Resolved: none; `.prettierignore` deleted (already staged) |
| R4 empty `Last-Event-ID` | Empty/whitespace-only = absent = 0 (§6.3) |
| R5 status codes | `202` for all four send/retry outcomes (§4.4, §4.5) |
| R6 "active response" | `status ∈ {pending, streaming}` (§3.2) |
| R8 title truncation | 60 code points, no ellipsis, placeholder `"New conversation"` (§3.3) |
| Test files in `dist` | Per-package `exclude` of `*.test.ts(x)` + root `tsconfig.test.json` (§8.2) |

Already-resolved domain decisions this spec conforms to and never re-opens: A-002 (interrupted ⇒ `failed` + standard single retry, §5.6), A-003 (replacement is not retryable, §3.4), A-008 (normalized = trimmed only, §3.1), A-010 (summary = id/title/updatedAt, title from first user message truncated, §3.3/§4.2).

---

## 2. Component design

Module inventory, directory layout and the 6 key mechanisms below are the approved design (Option A Lean Hexagonal + 2 adoptions from Option C). This section is the self-contained, authoritative design contract for implementation.

### 2.1 Recommended layout

```
packages/shared/src/
  index.ts                     barrel
  ids.ts                       branded id types + zod id schemas
  contracts/conversation.ts    Conversation, ConversationSummary, create/list bodies
  contracts/message.ts         Message, SendMessageRequest/Accepted
  contracts/response.ts        Response, ResponseStatus, ActiveResponse
  contracts/events.ts          SSE envelope + 4 payload schemas + discriminated union
  contracts/errors.ts          ErrorEnvelope schema + ErrorCode union
  contracts/params.ts          path params, Last-Event-ID parse schema
  contracts/health.ts          GET /health response schema (not enveloped)
  domain-rules/normalize.ts    normalizeContent (trim), codePointLength, MAX=4000
  domain-rules/title.ts        deriveConversationTitle + placeholder
  domain-rules/terminal.ts     isTerminalEventType / isTerminalStatus

apps/api/src/
  index.ts                     entrypoint: loadConfig -> createContainer -> recover -> buildServer -> listen -> shutdown
  config/env.ts                zod env schema, fail-fast loadConfig()
  domain/types.ts              server-side entities + status union
  domain/errors.ts             DomainError subclasses carrying stable codes
  domain/response-machine.ts   PURE allowed transitions, next-seq rule, terminal-once rule
  domain/idempotency.ts        PURE classify(existing, incoming) -> Same | Conflict | New
  domain/retry.ts              PURE classifyRetry() -> start | existing | rejected
  ports.ts                     Clock, IdGenerator, Provider, UnitOfWork, 4 repo interfaces
  persistence/db.ts            DatabaseSync open + pragmas + close
  persistence/schema.ts        deterministic DDL, indexes, partial unique terminal index
  persistence/unit-of-work.ts  BEGIN IMMEDIATE / COMMIT / ROLLBACK
  persistence/conversation-repo.ts | message-repo.ts | response-repo.ts | event-repo.ts
  persistence/row-contracts.ts zod validation of rows read back (FR-010)
  provider/types.ts            ProviderChunk = delta | end | error
  provider/deterministic-provider.ts   default mock, pure fn of normalized content
  stream/hub.ts                StreamHub subscribe/publish/closeAll
  stream/runner.ts             ResponseRunner: chunk -> appendEvent(commit) -> publish
  stream/subscribe.ts          attach: subscribe -> backfill -> dedupe-flush (STREAM-INV-1)
  stream/recovery.ts           boot: non-terminal -> failed + one terminal event (A-002)
  usecases/create-conversation.ts | list-conversations.ts | get-conversation.ts
  usecases/send-message.ts     atomic message+response, idempotency, start runner
  usecases/retry-response.ts
  http/server.ts               buildServer(deps): cors, requestId, error handler, routes
  http/error-envelope.ts       toErrorEnvelope(err, requestId) — redaction boundary
  http/logging.ts              structured fields: ids, lengths, status, codes only
  http/sse.ts                  SSE framing writer + heartbeat + abort wiring
  http/routes/health.ts | conversations.ts | messages.ts | responses.ts | response-events.ts
  bootstrap/container.ts       createContainer(config, overrides?) — the only injection seam
  bootstrap/shutdown.ts        signals: stop new work, close streams, close db
  testing/                     temp-db helper, fake clock/ids, provider doubles (delay/disconnect/fail)

apps/web/src/
  main.tsx                     root render
  config/env.ts                zod-validated import.meta.env
  api/http-client.ts           fetch + zod parse + error-envelope decode
  api/sse-client.ts            fetch+ReadableStream SSE reader, sets Last-Event-ID header
  state/chat-reducer.ts        PURE reducer incl. lastAppliedEventId guard
  state/ui-status.ts           sending|streaming|completed|failed|reconnecting|retrying + error kinds
  state/ChatProvider.tsx       context + dispatch + effect orchestration
  hooks/useSelectedConversation.ts   URL <-> selection
  hooks/useResponseStream.ts   connect/reconnect from lastAppliedEventId, backoff
  components/App.tsx | ConversationList.tsx | MessageList.tsx | MessageComposer.tsx
  components/StatusAnnouncer.tsx     aria-live region
  components/RetryButton.tsx
```
Tests colocated as `*.test.ts(x)` next to each source file.

### 2.2 Key mechanisms

- **Event IDs**: `stream_events` PK `(response_id, seq)`; `seq` allocated inside the write txn as `COALESCE(MAX(seq),0)+1` per response, from 1. SSE `id:` = `seq`. Response-scoped per FR-004; replay always filters by `response_id`, so cross-response leakage is impossible by query shape (FR-005).
- **Terminal-once**: partial unique index on `stream_events(response_id) WHERE type IN ('response.completed','response.failed')` as the hard invariant, plus a `response-machine.ts` guard for the friendly error. DB is the truth, domain is the message.
- **persist-then-emit**: `runner.ts` commits the event row, then publishes to the hub. Never the reverse. FR-004.
- **STREAM-INV-1 (replay/live handoff)**: in `stream/subscribe.ts`, with **no `await` between steps**: (1) subscribe with a buffering sink, (2) synchronous `listAfter(responseId, lastEventId)`, (3) write those frames tracking `maxSent`, (4) flush buffer dropping `seq <= maxSent`, (5) if terminal and drained, end the stream. Synchronous `node:sqlite` + single-threaded loop makes this atomic; the `seq` dedupe filter keeps it correct even if the invariant is later violated. Covers FR-005, AC-011.
- **Atomicity**: one `BEGIN IMMEDIATE` txn inserts the user message (with conversation-scoped `seq`), inserts the `pending` response, bumps the conversation's update marker. No `await` inside -> no interleaving. Injected-failure test asserts neither row survives (AC-006).
- **Ordering without wall-clock**: `messages.seq` integer per conversation for history order; conversation list ordered by a monotonic global `updated_seq` (not `updated_at`) -> deterministic under identical timestamps (FR-006, AC-007, A-010 tie-break).

Component design continued below adds only the contracts for this fixed layout.

Dependency rule (FR quality requirement "separate … concerns"): `shared` depends on `zod` only; `domain/*` and `domain-rules/*` depend on nothing (no zod, no IO); `persistence/*`, `provider/*` depend on `ports.ts` types only; `usecases/*` depend on ports + domain; `http/*` depends on usecases + shared; `bootstrap/container.ts` is the only module that constructs adapters. `apps/web` never imports `apps/api`.

Ports (`apps/api/src/ports.ts`), signatures only — no `any` anywhere in product code (FR quality requirement):

```ts
interface Clock { now(): string }                       // ISO-8601 UTC ms
interface IdGenerator { next(): string }                // opaque, injected (FR-003, AC-003)
interface UnitOfWork { run<T>(fn: () => T): T }         // sync: BEGIN IMMEDIATE/COMMIT/ROLLBACK
```

`Provider` is §3.5. Repositories are §5.3. All ports are plain interfaces + factory functions; no classes with inheritance, no DI container (approved design).

---

## 3. Domain contracts

### 3.1 Normalization and limits — `packages/shared/src/domain-rules/normalize.ts` (FR-010, AC-019, A-008, A-009)

```ts
export const MAX_CONTENT_CODE_POINTS = 4000;
export function normalizeContent(raw: string): string;       // === raw.trim()
export function codePointLength(value: string): number;       // Array.from(value).length
export type ContentCheck = "ok" | "empty" | "too-long";
export function checkContent(normalized: string): ContentCheck;
```

- `normalizeContent` is exactly `String.prototype.trim` (ECMAScript WhiteSpace + LineTerminator). Inner whitespace and case preserved (A-008).
- `codePointLength` counts code points, not UTF-16 units — `Array.from`/spread, never `.length` (AC-019 4000/4001 cases must be code-point exact).
- Order is fixed: normalize → `checkContent` → persist. `"   "` ⇒ `empty`; 4000 code points ⇒ `ok`; 4001 ⇒ `too-long` (AC-019).

### 3.2 Response state machine — `apps/api/src/domain/response-machine.ts` (FR-004, AC-010, R6)

```ts
export type ResponseStatus = "pending" | "streaming" | "completed" | "failed";
export type StreamEventType =
  | "response.started" | "response.delta" | "response.completed" | "response.failed";

export function isActiveStatus(s: ResponseStatus): boolean;    // pending | streaming  (R6)
export function isTerminalStatus(s: ResponseStatus): boolean;  // completed | failed
export function isTerminalEventType(t: StreamEventType): boolean; // shared/domain-rules/terminal.ts
export function nextSeq(maxSeq: number): number;               // maxSeq + 1, first = 1
export type TransitionCheck = "ok" | "illegal-transition" | "already-terminal";
export function checkTransition(from: ResponseStatus, to: ResponseStatus): TransitionCheck;
export type AppendCheck =
  | "ok" | "must-start-first" | "already-started" | "terminal-exists" | "not-streaming";
export function checkAppend(
  status: ResponseStatus, existingTypes: readonly StreamEventType[], next: StreamEventType
): AppendCheck;
```

- Legal transitions, exhaustively: `pending→streaming`, `pending→failed`, `streaming→completed`, `streaming→failed`. Everything else ⇒ `illegal-transition`; any `from` that is terminal ⇒ `already-terminal` (AC-010, AC-014).
- `checkAppend` rules (AC-010): seq 1 must be `response.started`; a second `response.started` is rejected as `already-started`; `response.delta` requires `status === "streaming"`; a terminal type is rejected when a terminal type already exists.
- `isTerminalEventType` lives in `packages/shared/src/domain-rules/terminal.ts` and is re-exported for web use; the api module re-exports it rather than duplicating (adoption #2 from Option C).

### 3.3 Title derivation — `packages/shared/src/domain-rules/title.ts` (FR-001, FR-002, A-010, R8)

```ts
export const MAX_TITLE_CODE_POINTS = 60;
export const PLACEHOLDER_TITLE = "New conversation";
export function deriveConversationTitle(firstUserMessageContent: string | null): string;
```

Rule, exactly: `null` ⇒ `PLACEHOLDER_TITLE`. Otherwise collapse every `\s+` run to a single U+0020, `trim`; if the result is empty ⇒ `PLACEHOLDER_TITLE`; if `codePointLength ≤ 60` ⇒ the result; else the first 60 code points, **no ellipsis, no word-boundary logic**. A conversation's title is written once (when its first user message is inserted, same transaction) and never recomputed.

### 3.4 Idempotency and retry — `apps/api/src/domain/idempotency.ts`, `retry.ts` (FR-008, FR-009, AC-008, AC-009, AC-017, A-003)

```ts
export interface ExistingSend { userMessageId: string; responseId: string; normalizedContent: string }
export type IdempotencyDecision =
  | { kind: "new" }
  | { kind: "duplicate"; userMessageId: string; responseId: string }
  | { kind: "conflict" };
export function classifySend(existing: ExistingSend | null, incomingNormalized: string): IdempotencyDecision;

export interface RetryTarget { status: ResponseStatus; retryOfResponseId: string | null }
export type RetryDecision =
  | { kind: "start" }
  | { kind: "existing"; responseId: string }
  | { kind: "rejected"; code: "RETRY_NOT_ALLOWED" | "RESPONSE_NOT_FAILED" };
export function classifyRetry(target: RetryTarget, existingReplacementId: string | null): RetryDecision;
```

- `classifySend`: `existing === null` ⇒ `new`; same key + byte-identical normalized content ⇒ `duplicate` with the original IDs (AC-008); same key + different normalized content ⇒ `conflict` (AC-009).

### 3.4a One active response per conversation — `apps/api/src/domain/idempotency.ts` (user-directed correction, 2026-09-27)

```ts
export type SendGate = "ok" | "blocked";
export function checkActiveResponseGate(hasActiveResponse: boolean): SendGate;
```

`checkActiveResponseGate` is `hasActiveResponse ? "blocked" : "ok"` — trivial on its own, but its **position in the check order is load-bearing**: it is evaluated **only** when `classifySend` has already returned `{ kind: "new" }`. A `duplicate` or `conflict` decision short-circuits before this gate runs, so replaying the same `clientMessageId` that itself created the currently-active response still succeeds identically (§4.4, §5.5 step 2b) — the gate blocks only a genuinely *new* send while one is in flight, never a replay of the one that is in flight.

- `classifyRetry` check order is fixed and load-bearing: (1) `target.retryOfResponseId !== null` ⇒ `rejected: RETRY_NOT_ALLOWED` (A-003, including a failed replacement); (2) `existingReplacementId !== null` ⇒ `existing` (AC-017 repeated retry); (3) `target.status !== "failed"` ⇒ `rejected: RESPONSE_NOT_FAILED`; (4) ⇒ `start`.

### 3.5 Provider — `apps/api/src/provider/*` (FR-003, AC-003, AC-016)

```ts
export interface ProviderInput { readonly responseId: string; readonly normalizedContent: string }
export type ProviderFailureCode =
  | "PROVIDER_ERROR" | "PROVIDER_DISCONNECTED" | "PROVIDER_TIMEOUT" | "PROVIDER_INTERRUPTED";
export type ProviderChunk =
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "end" }
  | { readonly kind: "error"; readonly code: ProviderFailureCode; readonly message: string };
export interface Provider { stream(input: ProviderInput): AsyncIterable<ProviderChunk> }
```

Deterministic default (`deterministic-provider.ts`) — pure function of `normalizedContent` only; no clock, no `Math.random`, no `crypto`, no network, no env read (FR-003, AC-003):

```ts
export const CHUNK_TOKENS = 3;
export function deterministicChunks(normalizedContent: string): readonly string[];
```

1. `tokens = normalizedContent.split(/\s+/u).filter(t => t !== "")` (never empty: content is non-empty after trim).
2. `replyTokens = ["Mock", "reply:", ...tokens]`.
3. Group `replyTokens` into consecutive groups of `CHUNK_TOKENS`; each group's chunk text = group joined by `" "`, plus one trailing `" "` for every group except the last.
4. Invariant asserted by unit test: `chunks.join("") === replyTokens.join(" ")` and `chunks.length === Math.ceil(replyTokens.length / 3) ≥ 1`.

Test doubles live in `apps/api/src/testing/provider-doubles.ts` and are injected through `createContainer(config, overrides)` — the only injection seam; no env var and no prompt string alters production behaviour (FR-003). Required doubles: `delayedProvider(msPerChunk)`, `disconnectingProvider(afterChunks)` (yields `error: PROVIDER_DISCONNECTED`), `failingProvider(code)`, `throwingProvider()` (throws a native `Error`; the runner maps any thrown value to `PROVIDER_ERROR`), `countingProvider(inner)` (exposes `runCount` for AC-008).

Failure messages exposed to clients come from a fixed map, never from the thrown value (AC-021):
`PROVIDER_ERROR → "The assistant could not complete this response."`, `PROVIDER_DISCONNECTED → "The assistant connection was lost."`, `PROVIDER_TIMEOUT → "The assistant took too long to respond."`, `PROVIDER_INTERRUPTED → "This response was interrupted by a server restart."`

---

## 4. Shared runtime contracts and HTTP API

All schemas are Zod 4.6.5, exported with `z.infer` types, and are the single definition used by Fastify route handlers and by `apps/web/src/api/*` (FR-010, AC-004). Every object schema is `.strict()`. Response bodies are parsed on the client as well as produced on the server, so an unknown field fails both sides.

### 4.1 Identifiers and primitives — `packages/shared/src/ids.ts` (FR-010, AC-019)

- Entity IDs are lowercase UUID v4 strings produced by the injected `IdGenerator` (production: `crypto.randomUUID()`), never by SQLite `lastInsertRowid` (A-011).
- `ConversationId`, `MessageId`, `ResponseId`: `z.uuid()` with `.brand<"ConversationId">()` etc.; branded types make cross-ID mix-ups a compile error.
- `clientMessageIdSchema = z.string().min(1).max(128)` — opaque, not normalized, not required to be a UUID.
- `isoTimestampSchema = z.iso.datetime({ offset: false })` — always UTC with milliseconds, e.g. `2026-09-27T10:00:00.000Z`.
- `seqSchema = z.int().positive()`; `eventIdSchema = z.int().nonnegative()` (0 = "nothing applied").
- Any request whose path param fails these schemas ⇒ `400 VALIDATION_FAILED` (AC-019 invalid-identifier case).

### 4.2 Entity contracts — `contracts/conversation.ts`, `contracts/message.ts`, `contracts/response.ts`

| Schema | Fields | IDs |
|---|---|---|
| `conversationSchema` | `id`, `title`, `createdAt`, `updatedAt` | FR-001, FR-002 |
| `conversationSummarySchema` | `id`, `title`, `updatedAt` | FR-002, A-010 |
| `messageSchema` | `id`, `conversationId`, `seq`, `role: z.enum(["user","assistant"])`, `content`, `clientMessageId: z.string().nullable()`, `createdAt` | FR-001, FR-006, AC-007 |
| `responseFailureSchema` | `code: providerFailureCodeSchema`, `message` | FR-008, AC-016 |
| `responseSchema` | `id`, `conversationId`, `userMessageId`, `assistantMessageId: nullable`, `status: responseStatusSchema`, `partialText`, `failure: nullable`, `retryOfResponseId: nullable`, `retriedByResponseId: nullable`, `createdAt`, `updatedAt` | FR-004, FR-008, AC-016, AC-017 |
| `responseStatusSchema` | `z.enum(["pending","streaming","completed","failed"])` | FR-004 |

`partialText` is the concatenation of applied deltas; for a `completed` response it equals the assistant message content. `retriedByResponseId` is derived at read time from the unique index of §5.2.

### 4.3 Endpoint contracts (FR-002)

| Method + path | Request schema | Success | Response schema | Error codes |
|---|---|---|---|---|
| `POST /api/conversations` | `createConversationRequestSchema = z.object({}).strict()`; absent body treated as `{}` | `201` | `createConversationResponseSchema = { conversation }` | `VALIDATION_FAILED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` |
| `GET /api/conversations` | — | `200` | `listConversationsResponseSchema = { conversations: ConversationSummary[] }` | `INTERNAL_ERROR` |
| `GET /api/conversations/:conversationId` | `conversationParamsSchema` | `200` | `getConversationResponseSchema = { conversation, messages, responses, activeResponse: Response \| null }` | `VALIDATION_FAILED`, `NOT_FOUND` |
| `POST /api/conversations/:conversationId/messages` | `sendMessageRequestSchema = z.object({ clientMessageId, content: z.string() }).strict()` | `202` | `sendMessageAcceptedSchema = { conversationId, userMessage: Message, response: Response }` | `VALIDATION_FAILED`, `NOT_FOUND`, `IDEMPOTENCY_KEY_CONFLICT`, `RESPONSE_ALREADY_ACTIVE`, `SERVICE_UNAVAILABLE` |
| `POST /api/responses/:responseId/retry` | `responseParamsSchema` | `202` | `retryAcceptedSchema = { conversationId, responseId, retryOfResponseId }` | `VALIDATION_FAILED`, `NOT_FOUND`, `RESPONSE_NOT_FAILED`, `RETRY_NOT_ALLOWED`, `SERVICE_UNAVAILABLE` |
| `GET /api/responses/:responseId/events` | `responseParamsSchema` + `Last-Event-ID` header (§6.3) | `200 text/event-stream` | §6 | `VALIDATION_FAILED`, `NOT_FOUND`, `INVALID_LAST_EVENT_ID`, `LAST_EVENT_ID_OUT_OF_RANGE` |
| `GET /health` | — | `200` / `503` | `healthResponseSchema = { status: z.enum(["ok","unavailable"]), database: z.enum(["ok","error"]) }` | not enveloped |

`GET /api/conversations/:conversationId` deliberately returns a **superset** of the FR-002 wording: `responses` (all responses of the conversation) in addition to `activeResponse`. Rationale: FR-008 + AC-016 require a failed response's retained partial text and its retry affordance to survive a page refresh, and AC-013 requires refresh not to duplicate messages; neither is expressible from `activeResponse` alone. `activeResponse` remains present and is exactly the element of `responses` whose status is active (§3.2), or `null`.

`/health`: `database: "ok"` when `SELECT 1` succeeds on the live handle. `status: "unavailable"` (HTTP `503`) when the database check fails **or** the process is draining (§7.3) — FR-002, FR-011.

### 4.4 Send semantics (FR-009, AC-008, AC-009, R5)

One `202` for both outcomes: a newly created pair, and an idempotent replay which returns the **full, current** `userMessage` and `response` objects for the original send (same IDs, not just the IDs) and starts no provider run. The client never has to make a follow-up `GET` to learn what it just idempotently replayed. `IDEMPOTENCY_KEY_CONFLICT` ⇒ `409`, zero writes, decided inside the transaction before any insert.

`RESPONSE_ALREADY_ACTIVE` ⇒ `409`, zero writes: raised when `classifySend` would return `{ kind: "new" }` but the conversation already has an active (`pending`/`streaming`) response — see §3.4a and §5.2 `ux_responses_one_active_per_conversation`. This check runs strictly after idempotency classification, so a duplicate-key replay of the send that created the active response still succeeds (§5.5 step 2b).

### 4.5 Retry semantics (FR-008, AC-017, A-003, R5)

One `202` for both a freshly created replacement and a repeated request that returns the existing replacement. Rejections are `409`. A retry creates a new response row for the **same** `userMessageId` and inserts no new message row (AC-017).

### 4.6 Error envelope — `contracts/errors.ts` (FR-002, FR-010, AC-021)

```ts
export const errorDetailSchema = z.object({ path: z.string(), message: z.string() }).strict();
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema, message: z.string(), requestId: z.string(),
    details: z.array(errorDetailSchema).optional()
  }).strict()
}).strict();
```

| `ErrorCode` | HTTP | Raised by |
|---|---|---|
| `VALIDATION_FAILED` | 400 | body/param schema failure, empty or >4000-code-point content (AC-019) |
| `INVALID_LAST_EVENT_ID` | 400 | header not `^\d{1,15}$` after trim: malformed, negative, decimal, over-long (AC-012) |
| `LAST_EVENT_ID_OUT_OF_RANGE` | 400 | value `> maxSeq` for that response (AC-012) |
| `NOT_FOUND` | 404 | unknown conversation or response |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | AC-009 |
| `RESPONSE_NOT_FAILED` | 409 | retry target not `failed` |
| `RETRY_NOT_ALLOWED` | 409 | target is itself a replacement (A-003) |
| `RESPONSE_ALREADY_ACTIVE` | 409 | a new send attempted while the conversation already has a `pending`/`streaming` response (§3.4a); never raised for a duplicate-key replay of the send that created it |
| `SERVICE_UNAVAILABLE` | 503 | draining (§7.3) |
| `INTERNAL_ERROR` | 500 | anything unmapped |
| `DATABASE_UNAVAILABLE` | 503 | SQLite open/health failure at request time |

Redaction contract, `http/error-envelope.ts` (AC-021) — `toErrorEnvelope(err: unknown, requestId: string): ErrorEnvelope`:

- Known `DomainError` subclass ⇒ its `code` + its **constant** `publicMessage` (a module-level literal, never string-interpolated with user or provider content).
- `ZodError` ⇒ `VALIDATION_FAILED`; `details[i].path = issue.path.join(".")`; `details[i].message` is taken from a fixed `issueCode → message` map in `contracts/errors.ts`, so no received value is echoed.
- Anything else (including `SqliteError`, `TypeError`, thrown strings) ⇒ `INTERNAL_ERROR` + `"Internal server error"`. Unit tests feed a stack-bearing `Error`, a SQLite error carrying an SQL statement, an error whose message contains an absolute file path, and an error whose message contains full message content, and assert the serialized envelope contains none of: `"at "`, `"SELECT"`, `"INSERT"`, `"/Users"`, `".ts:"`, the content string (AC-021).

---

## 5. Data model

### 5.1 `node:sqlite` usage (A-011 finalized, FR-006)

`import { DatabaseSync } from "node:sqlite"` — synchronous API, no npm dependency, no `--experimental-sqlite` flag on Node 24.21.0. One long-lived handle created in `persistence/db.ts`, closed by `bootstrap/shutdown.ts`. At open, in order: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`. Every statement prepared once at repository construction and reused. Transactions are explicit `db.exec("BEGIN IMMEDIATE" | "COMMIT" | "ROLLBACK")` inside `UnitOfWork.run`, which is synchronous and contains no `await` (this is what makes §"Key mechanisms" atomicity and `STREAM-INV-1` hold).
Verified and relied upon: `statement.run()` returns `lastInsertRowid`/`changes` as plain JS `number`; `changes` is used for optimistic-guard assertions. `lastInsertRowid` is never read — all IDs come from `IdGenerator` (AC-003 determinism, FR-003). Partial unique indexes (`CREATE UNIQUE INDEX … WHERE …`) are verified to work and are relied upon by §5.2.
`:memory:` is a legal `CHAT_DB_PATH` for tests; the directory of a file path is created with `mkdirSync(recursive)` before open.

### 5.2 Schema — `persistence/schema.ts`, applied idempotently at container construction (FR-006, AC-005)

`CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` executed in one transaction, in this fixed order, so the schema is deterministic and re-openable (AC-005). `TEXT` timestamps are ISO-8601 UTC ms.

```
conversations(
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  updated_seq INTEGER NOT NULL, has_user_message INTEGER NOT NULL DEFAULT 0)

messages(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  client_message_id TEXT,
  created_at TEXT NOT NULL)

responses(
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_message_id TEXT NOT NULL REFERENCES messages(id),
  assistant_message_id TEXT REFERENCES messages(id),
  status TEXT NOT NULL CHECK (status IN ('pending','streaming','completed','failed')),
  partial_text TEXT NOT NULL DEFAULT '',
  failure_code TEXT, failure_message TEXT,
  retry_of_response_id TEXT REFERENCES responses(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

stream_events(
  response_id TEXT NOT NULL REFERENCES responses(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN
    ('response.started','response.delta','response.completed','response.failed')),
  data TEXT NOT NULL,                      -- compact JSON, the exact SSE data payload
  created_at TEXT NOT NULL,
  PRIMARY KEY (response_id, seq))
```

Indexes, all required:

| Index | Purpose | IDs |
|---|---|---|
| `ux_messages_conversation_seq` UNIQUE `(conversation_id, seq)` | per-conversation ordering without wall clock | FR-006, AC-007 |
| `ux_messages_idempotency` UNIQUE `(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL` | idempotency key scope | FR-009, AC-008, AC-009 |
| `ux_responses_retry_of` UNIQUE `(retry_of_response_id) WHERE retry_of_response_id IS NOT NULL` | at most one replacement per response | FR-008, AC-017 |
| `ux_responses_one_active_per_conversation` UNIQUE `(conversation_id) WHERE status IN ('pending','streaming')` | at most one active response per conversation — DB-level hard invariant backing §3.4a; a second insert violates this index and the transaction rolls back even if the application-level gate is ever bypassed | FR-002, FR-004, FR-006 (user-directed correction, 2026-09-27) |
| `ux_stream_events_terminal` UNIQUE `(response_id) WHERE type IN ('response.completed','response.failed')` | terminal-once as a DB invariant | FR-004, AC-010 |
| `ix_conversations_updated_seq` `(updated_seq DESC)` | list ordering | FR-001, FR-002, AC-007 |
| `ix_responses_conversation_status` `(conversation_id, status)` | active-response lookup, boot recovery scan | FR-006, AC-014 |

Ordering contract (AC-007, deterministic under identical timestamps):
- Conversation list: `ORDER BY updated_seq DESC, id ASC`. `updated_seq` is allocated inside the write transaction as `SELECT COALESCE(MAX(updated_seq),0)+1 FROM conversations` — a global monotone counter, independent of `Clock`.
- Message history: `ORDER BY seq ASC`, `seq` allocated as `SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?`.
- Event replay: `ORDER BY seq ASC`, `seq` allocated as `SELECT COALESCE(MAX(seq),0)+1 FROM stream_events WHERE response_id = ?`.
All three allocations happen inside the same `BEGIN IMMEDIATE` transaction as their insert; `Clock` never participates in ordering.

### 5.3 Repository ports (FR-006)

Signatures only; every method is synchronous.

```ts
interface ConversationRepo {
  insert(row: NewConversation): void;
  findById(id: ConversationId): Conversation | null;
  listSummaries(): readonly ConversationSummary[];
  touch(id: ConversationId, updatedAt: string): void;           // allocates next updated_seq
  setTitleIfFirstUserMessage(id: ConversationId, title: string): void;
}
interface MessageRepo {
  insert(row: NewMessage): void;                                 // allocates conversation-scoped seq
  listByConversation(id: ConversationId): readonly Message[];
  findByIdempotencyKey(id: ConversationId, clientMessageId: string): ExistingSend | null;
}
interface ResponseRepo {
  insert(row: NewResponse): void;
  findById(id: ResponseId): ResponseRecord | null;
  listByConversation(id: ConversationId): readonly ResponseRecord[];
  findActiveByConversation(id: ConversationId): ResponseRecord | null;
  findReplacementOf(id: ResponseId): ResponseId | null;
  listActive(): readonly ResponseRecord[];                       // boot recovery
  updateStatus(id: ResponseId, status: ResponseStatus, updatedAt: string): void;
  appendPartialText(id: ResponseId, text: string): void;
  setCompleted(id: ResponseId, assistantMessageId: MessageId, updatedAt: string): void;
  setFailed(id: ResponseId, code: ProviderFailureCode, message: string, updatedAt: string): void;
}
interface EventRepo {
  append(responseId: ResponseId, type: StreamEventType, data: StreamEventData, createdAt: string): PersistedEvent;
  listAfter(responseId: ResponseId, afterSeq: number): readonly PersistedEvent[];
  maxSeq(responseId: ResponseId): number;                        // 0 when none
  hasTerminal(responseId: ResponseId): boolean;
}
```

`append` is the **single write path** for all response state (adoption #1 from Option C): it allocates `seq`, calls `checkAppend`, inserts the row, and is always called inside the same transaction that updates `responses.status`/`partial_text`.

### 5.4 Row re-validation — `persistence/row-contracts.ts` (FR-010)

Every row read from SQLite is parsed by a Zod row schema before it becomes a domain object; `stream_events.data` is `JSON.parse`d and then parsed by the matching payload schema from §6.2. A parse failure throws `PersistedRecordInvalidError` ⇒ `INTERNAL_ERROR` at the edge (never surfaced) (FR-010, AC-021).

### 5.5 Atomic send transaction (FR-006, FR-009, AC-006, AC-008, AC-009)

One `UnitOfWork.run`, no `await` inside, in this order: (1) load conversation ⇒ `NOT_FOUND`; (2) `findByIdempotencyKey` ⇒ `classifySend` ⇒ `duplicate` returns early with zero writes (the full `userMessage`/`response` rows, re-fetched by ID), `conflict` throws with zero writes; **(2b)** only when `classifySend` was `new`: `findActiveByConversation` ⇒ `checkActiveResponseGate` (§3.4a) ⇒ `blocked` throws `RESPONSE_ALREADY_ACTIVE` with zero writes, before any insert; (3) insert user message (allocated `seq`, `client_message_id`); (4) `setTitleIfFirstUserMessage` when `has_user_message = 0`, then set it to 1; (5) insert `pending` response — this insert is also the point the `ux_responses_one_active_per_conversation` index would reject a race that slipped past step 2b; (6) `touch` conversation. A fault injected at any of steps 3–6 rolls the whole transaction back, leaving neither the message nor the response (AC-006). The provider run is started **after** commit, outside the transaction.

### 5.6 Boot recovery — `stream/recovery.ts` (AC-014, A-002)

Runs once in `apps/api/src/index.ts` **before** `listen`, so no client can ever observe a stale active response. For each `ResponseRepo.listActive()` row, in **one transaction per row**, branch on `EventRepo.maxSeq(id)`:

- **Zero-event case** (`maxSeq === 0`, `status === "pending"` — the process crashed after inserting the response row but before the runner ever appended `response.started`): append `response.started` at `seq` 1, **then** append `response.failed` at `seq` 2 with `code = "PROVIDER_INTERRUPTED"` and its fixed message (§3.5), both in the same transaction. This is required, not optional: `checkAppend` (§3.2) rejects a terminal event as `seq` 1, so a response with no events cannot go straight to `response.failed` — it must be given its `response.started` first, atomically, so no reader ever observes a gap.
- **Partial-stream case** (`maxSeq >= 1`, `status === "streaming"` — at least `response.started` and zero or more `response.delta` already exist): append **only** `response.failed` at the next `seq`. Never re-append `response.started`.

Both cases then: set `status = "failed"` plus `failure_code`/`failure_message`, keep `partial_text` untouched, `touch` the conversation. The response then satisfies `classifyRetry` ⇒ `start` (unless it is itself a replacement), i.e. the standard single retry (A-002, A-003). Returns the count of recovered responses for the startup log line.

Both cases require dedicated automated coverage (INC-11): a zero-event pending response recovers to exactly `[response.started@1, response.failed@2]` and `status = "failed"`; a partial-stream response recovers to exactly one appended `response.failed` at `maxSeq + 1`, with its prior events and `partial_text` untouched.

---

## 6. Streaming protocol

### 6.1 Framing — `http/sse.ts` (FR-004)

Response headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`. Fastify handler takes over the raw stream (`reply.hijack()`), so no body serializer touches the frames.

Each event is exactly, in this field order:

```
id: <seq>\n
event: <type>\n
data: <compact JSON, single line>\n
\n
```

`data` is `JSON.stringify` of the payload with no spaces and no newlines (payloads never contain raw newlines because text is JSON-escaped). One `data:` line per event, always. Heartbeat is `: ping\n\n` every `SSE_HEARTBEAT_MS = 15000` (module constant, not an env var), carries no `id:` and no `event:`, and therefore cannot perturb the id sequence (AC-003, AC-010, R9).

### 6.2 Event payloads — `contracts/events.ts` (FR-004, AC-003, AC-004, AC-010)

```ts
export const responseStartedDataSchema   = z.object({ responseId, conversationId, seq }).strict();
export const responseDeltaDataSchema     = z.object({ responseId, seq, text: z.string() }).strict();
export const responseCompletedDataSchema = z.object({ responseId, seq, assistantMessage: messageSchema }).strict();
export const responseFailedDataSchema    = z.object({ responseId, seq, failure: responseFailureSchema }).strict();
export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response.started"),   data: responseStartedDataSchema   }).strict(),
  z.object({ type: z.literal("response.delta"),     data: responseDeltaDataSchema     }).strict(),
  z.object({ type: z.literal("response.completed"), data: responseCompletedDataSchema }).strict(),
  z.object({ type: z.literal("response.failed"),    data: responseFailedDataSchema    }).strict()
]);
```

`response.started`/`response.delta`/`response.failed` payloads contain no timestamp, duration, random value, or host path. `response.completed.data.assistantMessage` is the exception: it is the full persisted `Message` row (§4.2), which includes `createdAt` — needed so the client never has to re-fetch to render the final message. This means two independent runs over identical normalized content are byte-identical **only when driven by the same injected `Clock`** (already how every AC-003 test is built — INC-04's exit check and the AC-003 named test in INC-10 both inject one `fakeClock` seed shared by both compared runs); under a real wall-clock the `createdAt` field legitimately differs between two separate real sends, which is expected and outside AC-003's scope (AC-003 is about the provider's chunk generation, not clock-driven fields). `seq` is duplicated inside `data` so the web reducer's idempotency guard needs only the parsed payload (AC-013).
Per-stream shape invariant (AC-010): `seq` starts at 1 and increases by exactly 1; exactly one `response.started`; zero or more `response.delta`; exactly one of `response.completed` / `response.failed`, always last. `response.completed.data.assistantMessage.content` is the full assembled text and equals `partial_text` and the persisted assistant message.

### 6.3 `Last-Event-ID` parsing — `contracts/params.ts` (FR-005, AC-012, R4 finalized)

```ts
export type LastEventIdParse =
  | { kind: "ok"; value: number }
  | { kind: "malformed" };
export function parseLastEventId(header: string | undefined): LastEventIdParse;
```

Fixed rules, and these are the exact five AC-012 cases:

| Input | Result | HTTP |
|---|---|---|
| header absent | `ok: 0` | 200, full replay |
| `""` or whitespace-only | `ok: 0` (empty ≡ absent — R4) | 200, full replay |
| not `^\d{1,15}$` after trim (`"abc"`, `"-1"`, `"1.5"`, `"1e3"`, 16+ digits) | `malformed` | 400 `INVALID_LAST_EVENT_ID` |
| digits, `value > EventRepo.maxSeq(responseId)` | `ok` but out of range | 400 `LAST_EVENT_ID_OUT_OF_RANGE` |
| digits, `0 ≤ value ≤ maxSeq` | `ok: value` | 200, replay `seq > value` |

Leading zeros are accepted and parsed decimally (`"007"` ⇒ 7). Both 400s are emitted as an ordinary JSON error envelope **before** any SSE header is written, so the client sees a normal HTTP error (FR-005). Only the header is honoured; there is no query-parameter fallback.

### 6.4 Replay/live handoff — `stream/subscribe.ts` (FR-005, AC-011)

`STREAM-INV-1` from §2.2 is the contract: subscribe-with-buffer → synchronous `listAfter` → write frames tracking `maxSent` → flush buffer dropping `seq ≤ maxSent` → end if terminal and drained, with **no `await` between the five steps**. Observable guarantees to assert: frames arrive in strictly increasing `seq`, no `seq` appears twice, the concatenation of delta texts contains no repeated segment, the stream ends after the terminal frame, and a request for response A never yields a frame whose `data.responseId !== A` (the query is keyed by `response_id`, so cross-response leakage is impossible by query shape — FR-005).
Client abort (`request.raw.on("close")`) unsubscribes from the hub and clears the heartbeat timer; it never mutates response state.

### 6.5 Web SSE client — `apps/web/src/api/sse-client.ts` (FR-005, FR-007, R3)

Native `EventSource` is not used and must not appear in the codebase: a browser cannot set `Last-Event-ID` on the initial connection, which FR-005 + FR-007 together require. Contract:

```ts
export interface StreamHandle { close(): void }
export interface StreamCallbacks {
  onEvent(event: StreamEvent): void;
  onError(error: UiError): void;
  onClosed(reason: "terminal" | "aborted" | "network"): void;
}
export function openResponseStream(
  baseUrl: string, responseId: ResponseId, lastEventId: number,
  callbacks: StreamCallbacks, signal: AbortSignal
): StreamHandle;
```

Implementation contract: `fetch` with `headers: { "last-event-id": String(lastEventId) }`, `body` read as a `ReadableStream` through `TextDecoder("utf-8", { stream: true })`, frames split on `\n\n`, lines starting with `:` ignored, `id:`/`event:`/`data:` parsed, `data` `JSON.parse`d and then validated by `streamEventSchema` — an invalid payload calls `onError` with kind `server` and does not reach the reducer (AC-004). A non-2xx response body is parsed by `errorEnvelopeSchema` and mapped per §9.2. Reconnect policy (FR-005, FR-007): on `network` close while the response is still active, reconnect with `lastEventId = state.responses[id].lastAppliedEventId` after a backoff of `[250, 500, 1000, 2000, 4000]` ms capped at 4000, max 6 attempts, then surface `network` error with action `reload`.

---

## 7. Configuration and operations

### 7.1 API env — `apps/api/src/config/env.ts` (A-007 finalized, FR-006, FR-010)

Zod schema parsed once at boot from `process.env`; a failure prints the aggregated issue list and exits with code 1 (fail-fast, before any DB or socket).

| Var | Schema | Default |
|---|---|---|
| `CHAT_DB_PATH` | `z.string().min(1)` (`:memory:` allowed) | `./data/chat.sqlite` |
| `CHAT_API_PORT` | `z.coerce.number().int().min(1).max(65535)` | `8787` |
| `CHAT_API_HOST` | `z.string().min(1)` | `127.0.0.1` |
| `CHAT_WEB_ORIGIN` | `z.url()` | `http://localhost:5173` |
| `CHAT_LOG_LEVEL` | `z.enum(["fatal","error","warn","info","debug","trace"])` | `info` |

No other env var may alter behaviour — in particular there is no provider-selection env var (FR-003 "no environment-only backdoors"); provider substitution is only via `createContainer(config, overrides)`.

### 7.2 Web env — `apps/web/src/config/env.ts` (FR-010)

`VITE_API_BASE_URL`: `z.url()`, default `http://localhost:8787`, parsed from `import.meta.env` at module load; failure throws before render. No Vite dev proxy exists, so the browser calls the API cross-origin and CORS is genuinely exercised (AC-023).

### 7.3 CORS — `http/server.ts` (FR-010, AC-023)

`@fastify/cors` registered with `origin: [config.webOrigin]` (exact string match, no wildcard, no regex, no reflection), `methods: ["GET","POST","OPTIONS"]`, `allowedHeaders: ["content-type","last-event-id"]`, `credentials: false`, `maxAge: 600`. `last-event-id` must be in `allowedHeaders` or the cross-origin SSE request of §6.5 fails preflight. A request from any other origin receives no `access-control-allow-origin` header; the preflight for it returns `204` without that header (AC-023 asserts absence for a foreign origin and presence for the configured one).

### 7.4 Logging — `http/logging.ts` (FR-011, AC-021, A-006)

Fastify logger at `config.logLevel` with custom `req`/`res` serializers replacing the defaults. Field allowlist, exhaustive: `requestId`, `method`, `routePath` (the registered pattern, not the concrete URL), `statusCode`, `durationMs`, `conversationId`, `responseId`, `messageId`, `contentLength`, `eventSeq`, `eventType`, `errorCode`, `recoveredResponses`. Message content, provider text, SQL, stack traces, headers and env values are never logged, not even truncated (A-006). Unit test asserts that a log line produced for a send with a distinctive content string contains neither the string nor any substring of it longer than 3 characters.

### 7.5 Shutdown — `bootstrap/shutdown.ts` (FR-011)

The container holds a registry (`Set<{ controller: AbortController; promise: Promise<void> }>`) of in-flight runners; every `ResponseRunner` invocation registers its pair on start and removes it on settle (whether it completes, fails, or is aborted — the runner's `catch` maps `AbortError` to its own failure-append path same as any other provider error, so the registry's promise always settles, never rejects unhandled).

On `SIGINT` or `SIGTERM`, in order:
1. Set `draining = true` (⇒ `/health` returns `503 unavailable`; `POST` routes return `503 SERVICE_UNAVAILABLE`; `GET /api/responses/:id/events` is refused with `503`).
2. Call `controller.abort()` on every registry entry.
3. `hub.closeAll()` ends every open SSE response without writing a frame.
4. **Bounded drain**: `await Promise.race([Promise.allSettled(registry entries' promises), delay(SHUTDOWN_TIMEOUT_MS)])` — gives each aborted runner a chance to finish or roll back its in-flight persistence write before the database handle closes, without blocking shutdown indefinitely if a runner hangs.
5. `await fastify.close()`.
6. `db.close()`.
7. `process.exit(0)`.

`SHUTDOWN_TIMEOUT_MS = 5000` bounds step 4 specifically (not only an overall watchdog) — closing the DB before an aborted runner's write has settled risks a corrupt or half-applied write, which this ordering prevents except when a runner exceeds the timeout, in which case shutdown proceeds anyway rather than hanging. A second signal exits `1` immediately.

Requires dedicated automated coverage (INC-11, `bootstrap/shutdown.test.ts`): a `SIGINT`/direct `shutdown()` call issued while a fake, slow-but-not-hung provider run is in flight aborts it, awaits its settle inside the timeout, then closes the DB cleanly — asserting no `ERR_SQLITE_*`/unhandled-rejection and that the aborted response ends up `failed` (via the runner's own abort-handling path, not left `streaming`).

---

## 8. Toolchain contracts (AC-001)

### 8.1 Build order (A-012 finalized)

- `apps/api/tsconfig.json` and `apps/web/tsconfig.json` each gain `"references": [{ "path": "../../packages/shared" }]`.
- Root scripts become: `"typecheck": "tsc -b tsconfig.json && tsc -p tsconfig.test.json --noEmit"`, `"build": "tsc -b tsconfig.json && npm run build -w @rosetta-poc/chat-web"`, `"pretest": "tsc -b packages/shared/tsconfig.json"`, `"check": "npm run typecheck && npm test && npm run build"` (unchanged text). The root no longer fans `build`/`typecheck` out with `--workspaces`; `tsc -b` is dependency-aware, which the fan-out is not.
- `apps/web/package.json` `"build"` becomes `"vite build"` (the `tsc` half is now owned by `tsc -b`). `apps/api`/`apps/web`/`packages/shared` `"typecheck"` becomes `"tsc -b tsconfig.json"` so a single-package invocation also builds shared first.
- `pretest` exists because `@rosetta-poc/chat-shared` resolves to `./dist/index.js`; a bare `npm test` on a clean checkout would otherwise fail. A Vitest alias to `packages/shared/src` was rejected: it would let tests pass against a module graph the app never uses.
- New scripts: api `"start": "node dist/index.js"`; web `"dev": "vite"`; root `"dev:api": "npm run build -w @rosetta-poc/chat-shared && npm run build -w @rosetta-poc/chat-api && npm run start -w @rosetta-poc/chat-api"`, root `"dev:web": "npm run build -w @rosetta-poc/chat-shared && npm run dev -w @rosetta-poc/chat-web"`. No watch-mode script: `tsc --watch` backgrounded inside an npm script leaves orphan processes, and AC-001 does not need it.
- AC-001 constraint honoured: `dist/` and `*.tsbuildinfo` are gitignored, so `npm ci && npm run check` must work from zero — `tsc -b` does, the seed's `typecheck`-first fan-out would not once api/web import shared.

### 8.2 Test files out of `dist` (finalized)

Each package `tsconfig.json` gains `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]`. A new root `tsconfig.test.json` (`noEmit`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, DOM libs, `types: ["node"]`) includes `apps/**/*.test.ts`, `apps/**/*.test.tsx`, `packages/**/*.test.ts`, `apps/web/test/setup.ts`, `apps/web/vite.config.ts`, `vitest.config.ts`. Net effect: tests and both config files are strictly typechecked, nothing test-related is emitted to `dist`, and `apps/web/vite.config.ts` stops being untypechecked (a seed gap). `apps/api/src/testing/**` stays inside the build project — it imports no test framework.

### 8.3 Vitest projects (A-013 finalized; Vitest is exactly 5.0.0)

Root `vitest.config.ts`, single file, `clearMocks: true` retained, `test.projects` with exactly two entries:

| Project | environment | include |
|---|---|---|
| `node` | `node` | `apps/api/src/**/*.test.ts`, `packages/shared/src/**/*.test.ts` |
| `web` | `jsdom` | `apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx` (+ `setupFiles: ["apps/web/test/setup.ts"]`) |

`environmentMatchGlobs` is gone in Vitest 5 and must not be used. `packages/**/*.test.tsx` is deliberately not globbed — `packages/shared` stays TSX-free. `@vitejs/plugin-react` is deliberately **not** added to the `web` project: esbuild's JSX transform driven by `jsx: "react-jsx"` is sufficient and Fast Refresh injection in tests is unwanted.

`apps/web/test/setup.ts` contract — `globals` is not enabled, so Testing Library auto-cleanup does not fire on its own:

```ts
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => { cleanup(); });
```

Plus a presence guard: if `globalThis.ReadableStream`, `TextDecoder` or `TextEncoder` is missing under jsdom, assign them from `node:stream/web` / `node:util` before any test runs — `api/sse-client.ts` tests need all three (R2).

---

## 9. Web state and UI contracts

### 9.1 Status and error vocabulary — `state/ui-status.ts` (FR-001, AC-018)

```ts
export type UiResponseStatus =
  | "sending" | "streaming" | "completed" | "failed" | "reconnecting" | "retrying";
export type UiErrorKind = "network" | "server" | "validation" | "provider";
export type UiNextAction = "retry-send" | "retry-response" | "reload" | "fix-input";
export interface UiError {
  readonly kind: UiErrorKind; readonly code: string;
  readonly message: string; readonly nextAction: UiNextAction;
}
```

All six statuses are distinct values and each renders distinct visible text (FR-001). `sending` = request in flight before `202`; `retrying` = retry request in flight before its `202`; `reconnecting` = stream dropped and a reconnect attempt is scheduled or in flight.

### 9.2 Error classification (AC-018)

Fixed mapping, `api/http-client.ts`:

| Source | kind | nextAction |
|---|---|---|
| `fetch` rejects / stream closes with `network` | `network` | `reload` (send flow: `retry-send`) |
| envelope `VALIDATION_FAILED`, `INVALID_LAST_EVENT_ID`, `LAST_EVENT_ID_OUT_OF_RANGE`, `IDEMPOTENCY_KEY_CONFLICT` | `validation` | `fix-input` |
| envelope `NOT_FOUND`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `RESPONSE_NOT_FAILED`, `RETRY_NOT_ALLOWED`, `RESPONSE_ALREADY_ACTIVE`, or an unparseable body | `server` | `reload` |
| `response.failed` SSE event | `provider` | `retry-response` |

Four kinds ⇒ four visually and programmatically distinguishable states, each carrying exactly one next action (AC-018).

### 9.3 State shape — `state/chat-reducer.ts` (FR-001, FR-007, AC-013)

```ts
export type LoadState =
  | { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "error"; error: UiError };
export interface UiResponse {
  readonly id: ResponseId; readonly userMessageId: MessageId;
  readonly status: UiResponseStatus; readonly text: string;
  readonly lastAppliedEventId: number;                 // 0 = nothing applied
  readonly streamClosed: boolean;                      // terminal or explicitly closed; never reconnect
  readonly failure: ResponseFailure | null;
  readonly retryOfResponseId: ResponseId | null;
  readonly retriedByResponseId: ResponseId | null;
  readonly reconnectAttempt: number;
}
export interface ChatState {
  readonly conversations: readonly ConversationSummary[];
  readonly conversationsLoad: LoadState;
  readonly selectedConversationId: ConversationId | null;
  readonly conversationLoad: LoadState;
  readonly messages: readonly Message[];               // sorted by seq asc
  readonly responses: Readonly<Record<string, UiResponse>>;
  readonly draft: string;
  readonly sending: boolean;
  readonly lastError: UiError | null;
  readonly announcement: { readonly politeness: "polite" | "assertive"; readonly text: string };
}
export function chatReducer(state: ChatState, action: ChatAction): ChatState;
export const initialChatState: ChatState;
```

`chatReducer` is pure: no `Date`, no `fetch`, no `Math.random`, no module-level mutable state; it is the only place `ChatState` changes. All IO and timers live in `state/ChatProvider.tsx` and the two hooks.

### 9.4 Action union and reducer rules (FR-007, AC-008, AC-013)

`ChatAction` is a discriminated union on `type`, exhaustively:
`conversations/loading`, `conversations/loaded`, `conversations/failed`, `conversation/selected`, `conversation/loading`, `conversation/loaded`, `conversation/failed`, `conversation/created`, `draft/changed`, `send/requested`, `send/accepted`, `send/rejected`, `stream/opening`, `stream/reconnecting`, `stream/event`, `stream/error`, `stream/closed`, `retry/requested`, `retry/accepted`, `retry/rejected`, `error/dismissed`.

Load-bearing reducer rules:

1. **Idempotency guard (AC-013, FR-007):** for `stream/event`, if `action.event.data.seq <= response.lastAppliedEventId`, return the **same state object reference** (identity, asserted by test). Otherwise apply, then set `lastAppliedEventId = data.seq`. A replay therefore cannot append the same delta twice or duplicate a message, whether it arrives from backfill or from live.
2. **Delta:** `text += data.text`, `status = "streaming"` — deltas render in arrival order, which is `seq` order by rule 1 (AC-002).
3. **Completed:** `text = data.assistantMessage.content` (authoritative full text, overwrite not append), `status = "completed"`, and append `data.assistantMessage` to `messages` only if no message with that `id` is already present — dedupe by ID, never by content (AC-002, AC-013).
4. **Failed:** `status = "failed"`, `failure = data.failure`, `text` retained as-is (AC-016).
5. **Send:** `send/requested` sets `sending = true` and appends an optimistic user message keyed by its `clientMessageId`; `send/accepted` replaces that optimistic entry by `clientMessageId` match with the server row and inserts a `UiResponse` with `status: "sending"`, `lastAppliedEventId: 0`, `streamClosed: false`. A duplicate send that returns the original IDs therefore reconciles to exactly one message (AC-008).
6. **`conversation/loaded` seeding rule (FR-007):** for each server response, terminal ⇒ seed `text` from `partialText` (or from the assistant message for `completed`), `lastAppliedEventId = 0`, and `streamClosed = true`; active ⇒ seed `text = ""`, `lastAppliedEventId = 0`, and `streamClosed = false`, then let the replay of §6.4 rebuild the partial text. Stream opening/reconnect is gated by `streamClosed === false` and an active response status, never by a numeric sentinel. Mixing seeded text with replay from 0 is the duplication bug AC-013 forbids.
7. **Stream closure and reconnect:** applying `response.completed` or `response.failed`, or receiving `stream/closed` with reason `terminal`, sets `streamClosed = true`. `stream/opening` leaves it false. `stream/reconnecting` is allowed only while `streamClosed === false` and the underlying response remains active; it sets `status = "reconnecting"` and increments `reconnectAttempt`. A successful `stream/event` resets `reconnectAttempt = 0`.
8. Every action sets `announcement` per §9.6.

### 9.5 Selection from URL — `hooks/useSelectedConversation.ts` (FR-007)

The selected conversation lives in the URL as `?c=<conversationId>`, read on mount and written with `history.replaceState` on selection (no router dependency). On mount: parse, validate with `ConversationId` schema, dispatch `conversation/selected` then load. An invalid or unknown id clears the parameter and shows the empty state. This is what makes refresh restore the selection (FR-007, AC-013).

### 9.6 Accessibility and rendering contract (FR-001, AC-002, AC-018, AC-020, AC-022)

The end-to-end path AC-002 grades — create conversation, send, ordered deltas, completed assistant message — is realised by `ConversationList` (create/select), `MessageComposer` (send), `MessageList` (ordered `<li>` per `messages` entry, assistant text from `UiResponse.text` while streaming and from the assistant `Message` once completed) and the §9.4 rules that drive them.

`components/StatusAnnouncer.tsx` renders two always-mounted regions, both visually hidden via a `.sr-only` class using clip/offset (never `display: none`, never `hidden`, which would remove them from the accessibility tree):

- `<div role="status" aria-live="polite" aria-atomic="true">` — progress announcements.
- `<div role="alert">` — failures and errors (implicitly assertive).

Announcement text is a fixed table, so tests assert exact strings: `sending` ⇒ `"Sending message."`; `streaming` ⇒ `"Assistant is responding."`; `completed` ⇒ `"Assistant response complete."`; `reconnecting` ⇒ `"Connection lost. Reconnecting."`; `retrying` ⇒ `"Retrying response."`; `failed` ⇒ `"Response failed. <failure.message>"` (alert); validation error ⇒ `"Message not sent. <error.message>"` (alert); network error ⇒ `"Network error. <error.message>"` (alert); server error ⇒ `"Server error. <error.message>"` (alert). Streamed delta text is never routed into a live region.

Structure and semantics:

| Element | Contract |
|---|---|
| `App.tsx` | `<a href="#composer-input" class="sr-only-focusable">Skip to message input</a>`, then `<nav aria-label="Conversations">`, then `<main>` |
| `ConversationList.tsx` | `<nav aria-label="Conversations">` › `<button type="button">New conversation</button>` › `<ul>` › `<li>` › `<button type="button" aria-current={selected ? "true" : undefined}>` |
| `MessageList.tsx` | `<ol aria-label="Messages">` › `<li>` › `<article aria-label="You said" \| "Assistant said">`; no live region, no `aria-live` |
| `MessageComposer.tsx` | `<form>` › visible `<label for="composer-input">Message</label>` › `<textarea id="composer-input" required aria-describedby="composer-help composer-error" aria-invalid={hasError}>` › `<button type="submit">Send</button>` (`disabled` while `sending` **or** while any entry in `state.responses` has an active status — mirrors the server's one-active-response-per-conversation invariant, §3.4a/§5.2). `Enter` submits, `Shift+Enter` inserts a newline. A `RESPONSE_ALREADY_ACTIVE` reply (e.g. a second browser tab racing the same conversation) is still handled through the standard `server`-kind error path (§9.2), not a new UI state |
| `RetryButton.tsx` | `<button type="button" aria-describedby="failure-<responseId>">Retry</button>`, `disabled` while `status === "retrying"` |

Focus contract (AC-022): tab order is skip link → New conversation → conversation buttons → composer textarea → Send → Retry (when rendered). After `conversation/created` focus moves to `#composer-input`; after a successful send focus stays on the textarea and it is cleared; after `retry/accepted` the retry button unmounts and focus moves to `#composer-input`. Keyboard-only path create → select → send → observe status → retry is fully reachable with `Tab`/`Shift+Tab`/`Enter`/`Space` only, no pointer events.

Escaping (FR-010, AC-020): all user and provider text is rendered as JSX text children (`{value}`). `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write` and `new Function` must not appear anywhere in `apps/web`. A string such as `<img src=x onerror=alert(1)>` renders as visible text and never becomes an element.

---

## 10. Testing contracts (AC-024)

Layer inventory is fixed by §2 and the test contracts below. Cross-cutting rules: every integration test constructs a fresh temp DB path (`node:fs.mkdtempSync`) or `:memory:`; every test that asserts stable output injects `fakeClock(startIso)` and `sequentialIds(prefix)` through `createContainer(config, overrides)`; no test reads `process.env` other than through a per-test config object; no network access anywhere.

Required test data, by category:

- Happy: single-word content, multi-word content, content with inner double spaces and a newline, unicode content (emoji + CJK), content of exactly 4000 code points.
- Edge: `""`, `"   "`, `"\n\t "`, 4001 code points, a 4000-code-point string whose UTF-16 length is 8000 (surrogate pairs — proves code-point counting), `clientMessageId` of length 1 and 128.
- Error: malformed JSON body, missing `clientMessageId`, extra unknown field (`.strict()` rejection), non-UUID path param, unknown conversation, unknown response, retry of a `completed` response, retry of a replacement, second retry of the same response.
- `Last-Event-ID`: the five rows of §6.3 verbatim, plus `value === maxSeq` on a terminal response (immediate close, zero frames).
- Safety: `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` as message content (AC-020); an error whose message embeds a stack, an SQL statement, an absolute path and full message content (AC-021); a request from `http://evil.example` (AC-023).
- Determinism: the same normalized content run twice through two independent containers must produce byte-identical `data` strings for every event (AC-003).

---

## 11. Security considerations

Not a security-critical system (single local user, no auth, no PII, no network egress — non-goals in `docs/REQUIREMENTS.md`). Threat summary only:

| Threat | Control |
|---|---|
| Stored XSS via message or provider text | React text nodes only; the raw-HTML API ban of §9.6 (FR-010, AC-020) |
| Information disclosure through errors/logs | §4.6 redaction contract + §7.4 field allowlist (AC-021) |
| SQL injection | Prepared statements with bound parameters only; no string-concatenated SQL anywhere (§5.1) |
| Cross-origin data access | Exact-match single-origin CORS, `credentials: false` (§7.3, AC-023) |
| Resource exhaustion via oversized input | 4000-code-point cap enforced before any write (§3.1); `clientMessageId` capped at 128 |
| Unbounded stream fan-out | In-process hub, one process, local bind `127.0.0.1` (§7.1) |
| Secret leakage | No credentials exist; no provider key, no telemetry, no external service (FR-010) |

Accepted, documented limitation (R7): the in-process `StreamHub` means two API processes sharing one DB file would not share live events — explicitly sanctioned by the non-goal "horizontal scaling or multi-process stream coordination".

---

## 12. Dependencies

No new runtime or dev dependency. Everything is already in the seed manifests: `fastify@5.12.4`, `@fastify/cors@11.3.0`, `zod@4.6.5` (api + web + shared), `react@19.3.0`/`react-dom@19.3.0`, `vite@8.3.0`, `@vitejs/plugin-react@6.1.1`, `typescript@7.0.2`, `vitest@5.0.0`, `@testing-library/react@16.3.3`, `@testing-library/user-event@14.6.7`, `jsdom@30.0.1`, `@types/node@24.13.4`. Node built-ins used: `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:process`, `node:stream/web` and `node:util` (test setup only). Any addition beyond this list is a recorded study deviation.

---

## 13. Assumptions, out-of-product criteria and residual risks

Assumptions carried forward as facts (verified by the orchestrator, not to be re-verified): `DatabaseSync` statement `.run()` returns `lastInsertRowid`/`changes` as plain `number`; partial unique indexes work; installed Vitest is exactly 5.0.0.

Residual risks to confirm the first time `npm run check` runs, each with a stated fallback:

| Risk | Fallback if wrong |
|---|---|
| Vitest 5 `test.projects` key/shape (§8.3) | per-file `// @vitest-environment jsdom` docblock; `include` globs stay as specified |
| Vite resolving NodeNext `./x.js` imports to `x.ts` inside api tests | add a `resolve.extensions`-based alias in the `node` project only |
| Zod 4.6.5 top-level helper names `z.uuid()`, `z.iso.datetime()`, `z.int()`, `z.url()` | the equivalent `z.string().uuid()` / `.datetime()` / `z.number().int()` forms; schema semantics unchanged |
| jsdom missing `ReadableStream`/`TextDecoder` | the presence guard in `apps/web/test/setup.ts` (§8.3) already covers it |

Out-of-product criterion: **AC-015** is the `GOV-004` session-recovery experiment. It is produced by a separate run on its own branch from the same seed, its evidence is recorded separately, and `docs/CONTEXT.md` forbids copying any artifact between the two runs. No product code, test, or file in this spec can satisfy it; the only obligation this plan carries is that the committed artifacts of `EXP-002` (`docs/`, `plans/chat-poc/*`, `agents/IMPLEMENTATION.md`) are complete enough for a fresh session to resume from — which is what `GOV-004` will measure.

Evidence artifacts (AC-025, AC-026): `docs/experiment/EVIDENCE-MAP.md` (every FR/AC ⇒ implementation file + test file) and `docs/experiment/EXPERIMENT-LOG.md` (every missed requirement, manual correction, unexpected change, deferral). Both are created during the run; locations fixed by A-001.
