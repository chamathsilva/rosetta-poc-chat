# ARCHITECTURE

Technical shape of this workspace: module boundaries, the fixed technology target, testing, and build.
No business context — see `CONTEXT.md`. No file inventory — see `CODEMAP.md`. Versions in `TECHSTACK.md`, package graph in `DEPENDENCIES.md`, conventions in `PATTERNS/INDEX.md`.
Style: terse, grep-friendly headers, target state marked separately from built state. Loaded in every AI session, so keep it under 150 lines.

## Built state at this commit

**Seed only.** Three workspace members exist as compiling placeholders. There is no runtime architecture yet.

- `apps/api/src/index.ts` — `export {}` with a doc comment. No Fastify instance, no routes, no server bootstrap.
- `apps/web/src/main.tsx` — mounts a static `SeedPlaceholder` component via `createRoot` in `StrictMode`. No chat UI, no state, no HTTP calls.
- `packages/shared/src/index.ts` — `export {}`. No schemas.
- No test files exist anywhere (`vitest run --passWithNoTests`).
- No SQLite schema, no migrations, no `data/` directory, no SSE handling, no provider.

Everything below under **Target architecture** is the required end state, not present code.

## Fixed technology boundary

Set by `docs/REQUIREMENTS.md`. **Non-negotiable**; a substitution requires a recorded study deviation before implementation.

| Concern | Fixed choice |
| --- | --- |
| Runtime | Node.js 24.21.0 LTS (`.nvmrc`), `engines.node >=24` |
| Packages | npm 11.6.2, npm workspaces |
| Language | TypeScript 7.0.2, strict |
| Web | React 19.3.0 + Vite 8.3.0 |
| API | Fastify 5.12.4 (+ `@fastify/cors` 11.3.0) |
| Contracts | Zod 4.6.5 |
| Persistence | Node built-in SQLite module (**not** better-sqlite3 or an ORM) |
| Streaming | Server-Sent Events over HTTP (**not** WebSockets) |
| Tests | Vitest 5.0.0, Testing Library, jsdom |

Adding a runtime dependency outside this list is a boundary change, not an implementation detail.

## Workspace structure

npm workspaces over `apps/*` and `packages/*`; a TypeScript project-reference graph at the root.

- `apps/api` — `@rosetta-poc/chat-api`. Node service. `module`/`moduleResolution: NodeNext`, emits declarations to `dist/`.
- `apps/web` — `@rosetta-poc/chat-web`. Browser bundle. `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, DOM libs, types only to `dist/types` (Vite emits the bundle).
- `packages/shared` — `@rosetta-poc/chat-shared`. Consumed by both apps via `exports: ./dist/index.js`, so **shared must build before its consumers typecheck**.
- Root `tsconfig.json` has `files: []` and references all three; every member extends `tsconfig.base.json` with `composite: true`.
- Dependency direction: `api → shared`, `web → shared`. `api` and `web` must never import each other.

## Target architecture

### Layering

Required separation (Quality requirements, `REQUIREMENTS.md`): domain state · persistence · provider behavior · HTTP transport · stream coordination · shared contracts · UI state. Each is its own module; no layer reaches past its neighbor.

### `packages/shared` — contracts

- Zod schemas as the single source of truth for API request/response bodies and SSE event payloads, consumed by both api and web (AC-004).
- Types derive from schemas; no hand-written duplicate interfaces.

### `apps/api` — service

- **Transport** — Fastify routes per FR-002: conversation create/list/get, message post (`202`), retry, `GET /health`. One JSON error envelope: stable code, message, request id, optional field details; **never** a stack trace, SQL, path, or credential (AC-021).
- **Domain** — conversation/message/response state. A response reaches exactly one terminal outcome. `clientMessageId` is the per-conversation idempotency key (FR-009).
- **Persistence** — SQLite via the Node built-in module; configurable database path; deterministic local schema creation. User message + response record is written **atomically** (AC-006). Ordering must not depend on wall-clock timestamps alone (AC-007) — use a monotonic sequence.
- **Provider** — injected interface. Default implementation is deterministic: same normalized input yields byte-identical ordered chunks, no network, credentials, clock, or randomness (FR-003). Delayed / disconnecting / failing variants are injected **by tests only** — no production prompt triggers, no env-var backdoors.
- **Stream coordination** — persist each event *before* it is exposed (FR-004). Response-scoped monotonically increasing integer event ids. `GET /api/responses/:responseId/events` serves `text/event-stream`, honors `Last-Event-ID`, replays only later persisted events in order, then continues live or closes after the terminal event (FR-005). Events must never leak across responses.
- **Operations** — shutdown signals stop new work, close active streams, close SQLite cleanly. Structured request/failure logs **without** full message content (FR-011).

### `apps/web` — client

- Conversation list and thread view; controlled composer; explicit sending/streaming/completed/failed/reconnecting/retrying states (FR-001).
- Selected conversation lives in the URL so refresh restores it; on load, fetch persisted messages then reconnect from the last applied event id (FR-007).
- Event application is **idempotent** — replayed and live events must not duplicate messages or re-append a delta. Track the last applied id per response.
- All user and provider text renders as text; no `dangerouslySetInnerHTML`, no markdown rendering (FR-010, AC-020).
- Keyboard-operable throughout; status changes exposed to assistive technology via live regions (AC-022).

### Boundaries and safety

- Trim message content; reject empty and >4000 Unicode code points (FR-010).
- Validate at every boundary: identifiers, bodies, params, environment config, persisted records, SSE data.
- Dev CORS allows only the configured web origin (AC-023).
- No telemetry, no production credentials, no external runtime services.
- `any` is prohibited in product code; `tsconfig.base.json` additionally enforces `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.

## Testing

Vitest is the only runner. `vitest.config.ts` includes `apps/**/*.test.ts(x)` and `packages/**/*.test.ts`, with `clearMocks: true`.

- **Unit** — contracts, stream reduction, validation, idempotency, redaction-safe errors.
- **Integration** — API routes, SQLite persistence, event replay, restart recovery, retry.
- **Component** — Testing Library + jsdom: sending, streaming, reconnection, error, retry, accessible status.
- Temporary databases per test; deterministic clocks/ids wherever output stability matters. Mock external boundaries only — never the module under test.
- A web test environment (jsdom) is **not yet configured** in `vitest.config.ts`; component testing requires adding it.

## Build and verification

- `npm run check` = `typecheck` → `test` → `build`, each fanned out over workspaces with `--if-present`. This is the gate.
- `npm run typecheck` — `tsc --noEmit` per member. `npm run build` — `tsc -p` for api/shared; `tsc --noEmit && vite build` for web.
- `npm ci` under Node 24.21.0 must succeed from a clean checkout (AC-001).
- Ignored artifacts: `node_modules/`, `dist/`, `coverage/`, `data/`, `*.sqlite*`, `*.tsbuildinfo`, `*.log`, `agents/TEMP/`.
- No CI workflow, linter, or formatter config is present; `.editorconfig` (2-space, LF, UTF-8) and `.prettierignore` are the only style inputs.
