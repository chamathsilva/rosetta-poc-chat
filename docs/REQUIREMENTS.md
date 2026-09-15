# Streaming Chat Requirements

## Purpose

Build a small full-stack chat application that makes cross-layer contracts, streamed state, persistence, and recovery observable. The application must run locally without external AI credentials so its behavior and evidence remain reproducible.

## Fixed technology boundary

- Node.js 24.21.0 LTS and npm workspaces.
- TypeScript 7.0.2 in strict mode.
- React 19.3.0 with Vite 8.3.0 for the web client.
- Fastify 5.12.4 for the API.
- Zod 4.6.5 for runtime contracts.
- Node's built-in SQLite module for persistence.
- Server-Sent Events over HTTP for response streaming.
- Vitest 5.0.0 and Testing Library for automated tests.

Changing a fixed technology requires a recorded study deviation before implementation.

## Functional requirements

### FR-001 — Conversation interface

The web client must let one local user:

- view conversations ordered by most recently updated;
- create and select a conversation;
- view its ordered user and assistant messages;
- send a non-empty text message;
- see explicit sending, streaming, completed, failed, reconnecting, and retrying states.

The interface must remain usable by keyboard and expose status changes to assistive technology.

### FR-002 — HTTP API

Provide these JSON endpoints:

- `POST /api/conversations` creates a conversation.
- `GET /api/conversations` lists conversation summaries.
- `GET /api/conversations/:conversationId` returns a conversation, messages, and any active response.
- `POST /api/conversations/:conversationId/messages` accepts `{ "clientMessageId": string, "content": string }` and returns `202` with the persisted user-message ID and response ID.
- `POST /api/responses/:responseId/retry` starts or returns the single retry for a failed response.
- `GET /health` reports whether the API and database are ready.

Use one consistent JSON error envelope with a stable code, message, request ID, and optional field details. Do not expose stack traces to the client.

### FR-003 — Deterministic mock provider

Use an injected provider interface and a deterministic default implementation. Given the same normalized message, the default provider must produce the same ordered chunks without network access, credentials, wall-clock dependence, or randomness.

Tests must be able to inject delayed, disconnecting, and failing provider behavior without magic production prompts or environment-only backdoors.

### FR-004 — Streaming protocol

Stream each response from:

`GET /api/responses/:responseId/events`

using `text/event-stream`. Every event must include:

- a response-scoped monotonically increasing integer `id`;
- one of `response.started`, `response.delta`, `response.completed`, or `response.failed`;
- JSON data validated by the shared runtime contract.

Persist an event before exposing it to the client. A completed or failed response is terminal and must emit exactly one terminal event.

### FR-005 — Stream reconnection

Honor the standard `Last-Event-ID` request header. On reconnect, replay persisted events whose IDs are greater than the supplied ID, in order and without duplication, then continue the live stream or close after the terminal event.

Reject malformed, negative, or out-of-range event IDs with a stable client error. A client must not receive events belonging to another response.

### FR-006 — Persistence

Persist conversations, messages, responses, and stream events in SQLite. Use a configurable database path and create the local schema deterministically.

Data must survive page refresh and API restart. Writes that create a user message and its response record must be atomic. Stored message ordering must not rely only on wall-clock timestamps.

### FR-007 — Refresh and resume

After a page refresh, the client must restore the selected conversation from the URL, load persisted messages, and reconnect to an active response from the last applied event ID.

Applying replayed or live events must be idempotent: the UI must not duplicate messages or append the same delta twice.

### FR-008 — Failure and retry

A provider failure must persist and stream a safe failure result while retaining the user's message and any already persisted partial response.

The UI must offer one retry. Repeated retry requests for the same failed response must return the same replacement response rather than start duplicates. A successful retry must not duplicate the original user message.

### FR-009 — Message idempotency

`clientMessageId` is the idempotency key within a conversation. Repeating an identical request returns the original user-message and response IDs. Reusing the key with different content returns a conflict and creates nothing.

### FR-010 — Validation and boundaries

- Trim message content; reject empty content and content longer than 4000 Unicode code points.
- Validate identifiers, bodies, parameters, environment configuration, persisted records, and SSE data at runtime.
- Escape user and provider text in the browser; no raw HTML rendering.
- Allow only the configured web origin in development CORS policy.
- Use no telemetry, production credentials, or external runtime services.

### FR-011 — Operational behavior

- Handle shutdown signals by stopping new work, closing active streams, and closing SQLite cleanly.
- Log structured request and failure metadata without full message content.
- Keep generated databases, logs, builds, and coverage artifacts out of Git.

## Quality requirements

- Separate domain state, persistence, provider behavior, HTTP transport, stream coordination, shared contracts, and UI state.
- Do not use `any` in product code.
- Unit-test contracts, stream reduction, validation, idempotency, and redaction-safe errors.
- Integration-test API routes, SQLite persistence, event replay, restart recovery, and retry.
- Component-test sending, streaming, reconnection, error, retry, and accessible status behavior.
- Tests must use temporary databases and deterministic clocks or IDs where output stability matters.

## Non-goals

- Authentication, authorization, multiple users, tenants, or production deployment.
- Calling a real LLM or measuring model quality.
- WebSockets.
- Attachments, images, voice, markdown rendering, tools, or function calling.
- Conversation editing, branching, sharing, search, or export.
- Multiple retries or automatic retry loops.
- Horizontal scaling or multi-process stream coordination.
- Time, token, cost, or productivity benchmarking.
