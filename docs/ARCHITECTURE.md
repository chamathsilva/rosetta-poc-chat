# ARCHITECTURE

Purpose: technical architecture of this workspace for every AI session: modules, workspace structure, build, testing, building blocks, constraints.
Style: terse bullets; INSTALLED facts only (what exists in code). No business context: see `docs/CONTEXT.md`. File tree: `docs/CODEMAP.md`. Versions: `docs/TECHSTACK.md`, `docs/DEPENDENCIES.md`. Config conventions: `docs/PATTERNS/INDEX.md`. Progress: `agents/IMPLEMENTATION.md`. Exact contracts: `plans/chat-poc/chat-poc-SPECS.md` (referenced by section, not restated). Requirement → file → test map: `docs/experiment/EVIDENCE-MAP.md`.

## Status

- Updated in INC-14 (2026-10-12) to match published commit `cab37e1`. INC-00..INC-13 are implemented and tested; INC-14 is docs/close-out only.
- Before INC-14 this file still described the seed (placeholders, "Intended, NOT built"). It was not maintained increment by increment; see `docs/experiment/EXPERIMENT-LOG.md` (INC-14 entry).

## Workspace Structure

- npm workspaces monorepo, ESM (`"type": "module"`) everywhere, all packages `private`, deps exact-pinned.
- `packages/shared` → `@rosetta-poc/chat-shared`: Zod contracts (`contracts/{conversation,message,response,events,errors,params,health}.ts`), branded ids (`ids.ts`), zero-dependency domain rules (`domain-rules/{normalize,title,terminal}.ts`). Exports built `dist`.
- `apps/api` → `@rosetta-poc/chat-api`: Fastify API, layered `config` → `domain` → `ports` → `persistence` / `provider` / `stream` → `usecases` → `http` → `bootstrap` → `index.ts` (SPECS §2.1, dependency rules §2.2).
- `apps/web` → `@rosetta-poc/chat-web`: React SPA: `config/env.ts`, `api/{http-client,sse-client}.ts`, `state/{chat-reducer.ts,ChatProvider.tsx,ui-status.ts}`, `hooks/{useResponseStream,useSelectedConversation}.ts`, `components/*.tsx`, `main.tsx`.
- Dependency direction: api → shared, web → shared. api and web never import each other.
- `tsconfig.base.json`: ES2024, strict + noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noUnusedLocals/Parameters, verbatimModuleSyntax, skipLibCheck.
- api/shared: NodeNext (relative imports carry `.js`), composite, emit `dist`. api `types: ["node"]`.
- web: ESNext/Bundler, `jsx: react-jsx`, DOM libs, `types: ["vite/client"]`; tsc emits types only, Vite bundles.

## Build and Scripts (A-012 resolved)

- api and web tsconfigs `reference` `packages/shared`; the root `tsconfig.json` references all three. `tsc -b` builds in dependency order.
- Root scripts:
  - `typecheck` = `tsc -b tsconfig.json && tsc -p tsconfig.test.json --noEmit` (product + test files);
  - `build` = `tsc -b tsconfig.json` then `vite build` for web;
  - `pretest` builds shared;
  - `test` = `vitest run --passWithNoTests`;
  - `check` = typecheck && test && build;
  - `dev:api` builds shared + api, then `node dist/index.js`;
  - `dev:web` builds shared, then `vite`.
- Runtime: Node 24.21.0 via `.nvmrc`, npm 11.6.2 (`packageManager`); `engines.node >=24`.
- Absent by decision: lint/format tool (A-014), CI config, Vite dev proxy (the browser calls the API cross-origin, so CORS is exercised).
- Ignored by git: `node_modules/ dist/ coverage/ data/ *.sqlite* *.tsbuildinfo *.log agents/TEMP/ refsrc/`.

## Configuration (A-007 resolved; SPECS §7.1, §7.2)

- API, `apps/api/src/config/env.ts`, Zod fail-fast at boot (exit 1, values never printed):
  - `CHAT_DB_PATH` = `./data/chat.sqlite` (`:memory:` allowed);
  - `CHAT_API_PORT` = 8787;
  - `CHAT_API_HOST` = `127.0.0.1`;
  - `CHAT_WEB_ORIGIN` = `http://localhost:5173`;
  - `CHAT_LOG_LEVEL` = `info`.
- Web, `apps/web/src/config/env.ts`: `VITE_API_BASE_URL` = `http://localhost:8787`.
- No provider-selection variable: substitution is only via `createContainer(config, overrides)` (FR-003, no env backdoors).

## Persistence (A-011 resolved; SPECS §5)

- `node:sqlite` `DatabaseSync`, one long-lived synchronous handle, opened with WAL, `foreign_keys = ON`, `busy_timeout = 5000`.
- Four tables, deterministic schema creation (SPECS §5.2). Partial unique index `ux_responses_one_active_per_conversation` backs the one-active-response gate.
- `unit-of-work.ts`: explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`; synchronous only, so a Promise-returning callback is rejected.
- App-generated UUID ids via an injected `IdGenerator`; ordering by stored sequence/tie-break, never timestamp alone. Rows are re-validated with shared Zod schemas on read.

## Runtime building blocks

- Provider: `provider/deterministic-provider.ts` (default, no network or credentials); `testing/provider-doubles.ts` for delay, disconnect and failure in tests only.
- Stream: `stream/runner.ts` persists each event before publishing to `stream/hub.ts` (keyed by response id). `stream/subscribe.ts` does a synchronous replay → live handoff with sequence dedupe and detaches its subscriber on failure. `stream/recovery.ts` turns non-terminal responses into `failed` before listen (SPECS §5.6).
- HTTP: `http/server.ts`:
  - exact-origin CORS;
  - strict shared-schema parsing;
  - a fixed JSON error envelope (`http/error-envelope.ts`) with no stacks, SQL or paths;
  - an exhaustive log-field allowlist (`http/logging.ts`, no message text).
- SSE: `http/sse.ts` frames, with heartbeat `: ping` every 15 s.
- Routes (contract SPECS §4.3): `POST/GET /api/conversations`, `GET /api/conversations/:conversationId`, `POST /api/conversations/:conversationId/messages` (202), `POST /api/responses/:responseId/retry`, `GET /api/responses/:responseId/events` (SSE, `Last-Event-ID` validated before headers), `GET /health`.
- Bootstrap: `bootstrap/container.ts` composition root.
  - `bootstrap/shutdown.ts` handles SIGINT/SIGTERM in SPECS §7.5 order: start draining (503s), abort in-flight runs, `hub.closeAll()`, await the runs bounded by `SHUTDOWN_TIMEOUT_MS = 5000`, `app.close()`, then close the DB.
  - `index.ts` binds `app.server` directly so Fastify's listen URL is never logged (SPECS §7.4/§7.5).
- Web:
  - `ChatProvider` dispatches send/retry/load results only if the selection generation is unchanged, and retains network-failure send keys per conversation;
  - `useResponseStream` reconnects from `lastAppliedEventId` with backoff 250/500/1000/2000/4000 ms, at most 6 attempts, cancelled on selection change and unmount;
  - `useSelectedConversation` keeps the selection in URL `?c=`;
  - SSE uses `fetch` streaming, never `EventSource`;
  - text renders as text, with no raw-HTML API.

## Testing (A-013 resolved; SPECS §8.3, §10)

- Root `vitest.config.ts` has two projects:
  - `node`: `apps/api/src/**/*.test.ts`, `packages/shared/src/**/*.test.ts`;
  - `web`: `environment: "jsdom"`, `apps/web/src/**/*.test.{ts,tsx}`, `setupFiles: apps/web/test/setup.ts` (`afterEach(cleanup)`, stream/decoder presence guards).
- `clearMocks: true`.
- Test files are typechecked separately by `tsconfig.test.json`.
- Layers at `cab37e1`: 36 files / 437 tests:
  - unit (INC-10);
  - API integration + SQLite/restart, including real child-process tests of built `dist/index.js` (INC-11);
  - SSE replay (INC-12);
  - React component/provider/hook under jsdom with stubbed `fetch` (INC-13).
- Rules: test-owned temp databases (`testing/temp-db.ts`), `fakeClock` + `sequentialIds` where output stability matters, owned-resource cleanup.
- Not present: real-browser E2E (manual observations only), lint.

## Constraints

- Fixed technology (change = recorded study deviation): Node 24.21.0, TypeScript 7.0.2 strict, React 19.3.0 + Vite 8.3.0, Fastify 5.12.4 + @fastify/cors 11.3.0, Zod 4.6.5, `node:sqlite`, SSE (no WebSockets), Vitest 5.0.0 + Testing Library.
- No `any` in product code; no telemetry; logs carry ids, lengths, status and error codes only.
- The direct `app.server` bind relies on Node ≥ 19 `server.close()` closing idle keep-alive sockets (covered by a real-process test).
