# Rosetta Implementation Summary

This file is a brief and durable summary of the implementation state.
It is intentionally concise and should not be used as a chronological work log.
Only implementation change log in this workspace. DRY: behavior in `docs/CONTEXT.md`, structure in `docs/ARCHITECTURE.md`, contract in `docs/REQUIREMENTS.md` / `docs/ACCEPTANCE-CRITERIA.md`.

For detailed change history, use git history and PRs instead of expanding this file.

## Baseline State (chat-seed-v1)

- Seed commit `c86f73e`, tag `chat-seed-v1`; branch `experiment/EXP-002` starts here.
- Implemented: npm workspace (api, web, shared), strict TS project references, pinned deps, root Vitest config, `npm run check` pipeline.
- Placeholders only: `apps/api/src/index.ts` (`export {}`), `packages/shared/src/index.ts` (`export {}`), `apps/web/src/main.tsx` (static seed page).
- Not implemented: routes, contracts, provider, SQLite schema/persistence, SSE, reconnect, retry, recovery, product tests.
- AC status: none passed (AC-001 applies to workspace only at seed).

## Major Implemented Workstreams

### Rosetta workspace init (init-workspace-flow): complete, 2026-09-26

- Added Rosetta docs: `docs/TECHSTACK.md`, `docs/CODEMAP.md`, `docs/DEPENDENCIES.md`, `docs/PATTERNS/`, `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/ASSUMPTIONS.md`, `docs/TODO.md`, `agents/IMPLEMENTATION.md`, `agents/MEMORY.md`, `gain.json`.
- Updated `.gitignore` (Rosetta entries), added `.prettierignore`.
- No product code changed.

### INC-00 — toolchain foundation: complete, 2026-09-27

- Corrected TypeScript project-reference build order, test isolation, Vitest projects, and web jsdom setup (AC-001).
- Published checkpoint: `a20c0bb`; evidence follow-up: `aa6a319`.

### INC-01 — shared contracts and domain rules: complete, 2026-09-27

- Added shared Zod contracts, branded identifiers, normalization, title, terminal and Last-Event-ID rules (FR-010; AC-004, AC-012, AC-019).
- Published checkpoint: `e3900d5`; evidence follow-up: `bc35ec1`.

### INC-02 — API config, domain and ports: complete, 2026-09-28

- Added fail-fast API env parsing, domain types/errors, response state machine, idempotency and retry decisions, active-response gate, provider/repository ports (FR-009, FR-010; AC-008, AC-009, AC-010).
- Execution review added explicit duplicate-`response.started` rejection and moved Node ambient types to API project configuration.
- Validated with pinned Node 24.21.0: full `npm run check`, import-boundary check, all 16 transition pairs and append/idempotency/retry smoke cases.
- Published implementation checkpoint: `71ee630`.

### INC-03 — SQLite persistence: complete, 2026-09-28

- Added the synchronous `node:sqlite` handle, deterministic four-table/seven-index schema, unit of work, row re-validation, and conversation/message/response/event repositories.
- Preserved the no-`await` transaction boundary, app-generated identifiers, deterministic sequence ordering, DB-backed idempotency/retry/active-response/terminal invariants, and restart-safe file storage.
- Corrected SPECS §2.2 so the persistence dependency rule permits the pure domain guards/errors and shared/Zod row schemas explicitly required by §5.3–§5.4.
- Validated under pinned Node 24.21.0 with the full `npm run check`, Claude Code's 32-case exit smoke, and a separate orchestrator smoke covering schema idempotence/counts, sync rollback, ordering, idempotency, event sequencing, terminal-once, and file-backed restart.
- Published implementation checkpoint: `ec2a244` (`ec2a2448348f6d330926c5d5dff18fea02aa3a73`).
