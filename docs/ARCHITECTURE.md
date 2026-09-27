# ARCHITECTURE

Purpose: technical architecture of this workspace for every AI session: modules, workspace structure, build, testing, building blocks, constraints.
Style: terse bullets; INSTALLED (exists in code at seed) strictly separated from INTENDED (target from fixed docs, not built). No business context: see `docs/CONTEXT.md`. File tree: `docs/CODEMAP.md`. Versions: `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`. Config conventions: `docs/PATTERNS/INDEX.md`. Progress: `agents/IMPLEMENTATION.md`.

## Status

- HEAD = `chat-seed-v1`. Only toolchain/workspace wiring exists. All three source modules are placeholders.
- Architecture below "Intended" is a boundary from `docs/REQUIREMENTS.md`, not a design. Concrete module/file layout is undecided and belongs to the EXP-002 tech spec.

## Workspace Structure (installed)

- npm workspaces monorepo, ESM (`"type": "module"`) everywhere, all packages `private`, deps exact-pinned.
- `apps/api` -> `@rosetta-poc/chat-api`: Fastify API. `src/index.ts` = `export {}` placeholder.
- `apps/web` -> `@rosetta-poc/chat-web`: React + Vite SPA. `src/main.tsx` renders static `SeedPlaceholder`; `index.html` mounts `#root`.
- `packages/shared` -> `@rosetta-poc/chat-shared`: shared Zod contracts. `src/index.ts` = `export {}` placeholder. Exports `./dist/index.js` + `./dist/index.d.ts` (consumers resolve BUILT output).
- Dependency direction: api -> shared, web -> shared. api and web never import each other.
- Root `tsconfig.json`: solution file, `references` to all 3 packages, `files: []`.
- `tsconfig.base.json`: ES2024, strict + noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noUnusedLocals/Parameters, verbatimModuleSyntax (use `import type`), skipLibCheck.
- api/shared: `module`/`moduleResolution` NodeNext (relative imports need `.js` extension), emit to `dist`.
- web: `module` ESNext, `moduleResolution` Bundler, `jsx` react-jsx, lib DOM; tsc emits only types to `dist/types`, Vite bundles.

## Build and Scripts (installed)

- Root: `build`, `typecheck` fan out via `--workspaces --if-present`; `test` = `vitest run --passWithNoTests`; `test:watch`; `check` = typecheck && test && build.
- api/shared: `build` = `tsc -p`, `typecheck` = `tsc -p --noEmit`.
- web: `build` = `tsc --noEmit && vite build`; `typecheck` = `tsc --noEmit`.
- Seed verification (AC-001): `nvm use && npm ci && npm run check` (Node 24.21.0 via `.nvmrc`; `engines.node >=24`).
- ABSENT: `dev`/`start` scripts, API entrypoint/listen, ports, Vite proxy, env config, lint/format tool, CI config.
- Ignored by git: `node_modules/ dist/ coverage/ data/ *.sqlite* *.tsbuildinfo *.log agents/TEMP/ refsrc/`.

## Testing (installed)

- Single root `vitest.config.ts`; include globs: `apps/**/*.test.ts`, `apps/**/*.test.tsx`, `packages/**/*.test.ts`; `clearMocks: true`.
- Test tooling installed at root: Vitest, @testing-library/react, @testing-library/user-event, jsdom.
- No tests exist. No `environment` set (Vitest default `node`): React component tests need jsdom via config or per-file directive.
- `packages/**/*.test.tsx` not matched by globs.

## Known Wiring Risks (seed)

- api/web tsconfigs have no `references` to shared and shared exports `dist`: once code imports shared, shared must be built before api/web typecheck/build. Root fan-out order is not guaranteed dependency-aware. Unverified: see `docs/ASSUMPTIONS.md`.
- `vite.config.ts` is outside web tsconfig `include` (not typechecked).

## Intended Architecture (target, NOT built)

Fixed technology (change = recorded study deviation, FR "Fixed technology boundary"):
- Node.js 24.21.0, TypeScript 7.0.2 strict, React 19.3.0 + Vite 8.3.0, Fastify 5.12.4 (+ @fastify/cors), Zod 4.6.5.
- Persistence: Node built-in SQLite module (no npm SQLite dependency). Configurable DB path; deterministic schema creation.
- Streaming: Server-Sent Events over HTTP (`text/event-stream`). WebSockets excluded.
- Tests: Vitest 5.0.0 + Testing Library.

Required separation of concerns (quality requirements; layout TBD):
- shared contracts: Zod schemas for every API body, param, SSE payload; used by both api and web (AC-004).
- domain state: conversation/message/response/event rules, retry, idempotency.
- persistence: SQLite repositories, atomic user-message + response creation, ordering not by timestamp alone.
- provider: injected interface; deterministic default mock; test doubles for delay/disconnect/failure (no magic prompts, no env backdoors).
- stream coordination: persist-then-emit, per-response monotonically increasing integer event IDs, `Last-Event-ID` replay, one terminal event.
- HTTP transport: Fastify routes, consistent JSON error envelope (code, message, requestId, optional details; no stack traces), CORS = configured web origin only.
- UI state: idempotent event application, reconnect from last applied ID, URL-restored selection, accessible status.

Endpoints (contract in FR-002/FR-004; do not duplicate here):
- `POST/GET /api/conversations`, `GET /api/conversations/:conversationId`, `POST /api/conversations/:conversationId/messages` (202), `POST /api/responses/:responseId/retry`, `GET /api/responses/:responseId/events` (SSE), `GET /health`.

SSE event types: `response.started`, `response.delta`, `response.completed`, `response.failed`.

Operational (FR-011): graceful shutdown (stop new work, close streams, close SQLite); structured logs with IDs, lengths, status, error codes only (never message text, not truncated); no `any` in product code; no telemetry.

## Intended Test Layers (target, NOT built)

- Unit: contracts, stream reduction, validation, idempotency, redaction-safe errors.
- API integration: routes, SQLite persistence, event replay, restart recovery, retry.
- Component: sending, streaming, reconnection, error, retry, accessible status.
- Rules: temporary databases; deterministic clocks/IDs where output stability matters. Full list: AC-024, AC-012, AC-019.
