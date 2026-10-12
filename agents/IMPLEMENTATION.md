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
- AC status: none passed (AC-001 applies to workspace only at seed). Current status per criterion: `docs/experiment/EVIDENCE-MAP.md`.

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

### INC-04 — provider and stream coordination: complete, 2026-09-28

- Added the deterministic provider and provider doubles, persist-before-publish response runner, response-keyed live hub, synchronous replay/live handoff, and restart recovery for both zero-event pending and partial-stream responses.
- Provider failures use fixed safe messages; provider-supplied and thrown messages are not persisted or emitted. Completion persists the assistant message and terminal event atomically.
- Independent review added cleanup for synchronous backlog/read or sink/write failure so a failed stream attachment cannot leak its buffering subscriber; SPECS §6.4 and the INC-12 regression-test plan now carry this requirement.
- Validated under pinned Node 24.21.0 with full `npm run check`, Claude Code's 22-case exit smoke, an independent success/failure/abort/recovery/replay probe, static synchronous-handoff checks, and the focused subscriber-cleanup probe.
- Published implementation checkpoint: `2b8e3b4` (`2b8e3b4fffd5b28358889f0fe6da36c56d663f8b`).

### INC-05 — use cases: complete, 2026-09-28

- Added synchronous create/list/get conversation, send-message, and retry-response use cases with full shared-contract response bodies.
- Send preserves atomic message/title/response/touch writes, idempotent full-object replay, conflict/active zero-write exits, and starts the provider run only after commit.
- Execution review extended the one-active-response gate to genuinely new retry replacements. Repeated retry replay still returns its existing active replacement; a different active response now produces `RESPONSE_ALREADY_ACTIVE` instead of leaking a raw SQLite unique-index error.
- Validated under pinned Node 24.21.0 with full `npm run check`, Claude Code's 15-case exit smoke, static boundary checks, and an independent 18-assertion SQLite smoke.
- Published implementation checkpoint: `679f522` (`679f52247792a572087301fff063caaaeef404a5`).

### INC-06 — HTTP/SSE transport: complete, 2026-09-28

- Added Fastify route composition, strict shared-contract parsing, fixed/redacted error envelopes, exact-origin CORS, draining gates, exhaustive structured-log filtering, exact SSE framing/heartbeat, and pre-header `Last-Event-ID` validation.
- Added the fixed Zod issue-code message map required by SPECS §4.6 after INC-06 exposed its omission from the INC-01 contract surface.
- Guided live-server verification covered route codes, all five `Last-Event-ID` cases, full replay frames, disconnect/detach/replay, malformed bodies, CORS, active-response/retry behavior, draining, and log-field absence. Independent verification passed the full pinned-Node gate and a separate 27-group HTTP/CORS/SSE/redaction probe.
- Carried one concrete INC-07 requirement forward: suppress Fastify's successful-listen message because its free-text URL contains environment-derived host/port outside the exhaustive log allowlist.
- Published implementation checkpoint: `3d84946` (`3d84946fc3e2ec58b2add574667245d6c1441097`).

### INC-07 — bootstrap, shutdown, entrypoint and test helpers: complete, 2026-09-28

- Added the composition root, before-listen active-response recovery, in-flight `{controller, promise}` registry, bounded graceful shutdown, signal handling, log-safe API entrypoint, and deterministic clock/ID/temp-DB helpers.
- Suppressed Fastify's successful-listen URL by preparing Fastify and binding `app.server` directly. Documented the resulting Node/Fastify version dependency and carried an idle-keep-alive shutdown regression into INC-11.
- Guided verification passed startup, health, process restart, both recovery branches, bounded drain, second-signal exit, idle keep-alive closure, helper contracts and startup-log allowlisting. Independent review passed the full Node 24.21.0 gate and a separate 12-assertion composition/health/helper/shutdown probe.
- Corrected SPECS §10/§12 to allow `node:os.tmpdir()` for the temp-DB helper; no package dependency was added.
- Published implementation checkpoint: `4aa99d7` (`4aa99d7c9e21cf99f185799763288cac8584e8ee`).

### INC-08 — web client foundation: complete, 2026-09-29

- Added web env parsing, the typed HTTP client with §9.2 error classification, the `fetch`-based SSE client (no `EventSource`), and the pure chat reducer.
- Review fixed three contract defects before validation: loaded-conversation re-seeding per §9.4 rule 6, callback exceptions misread as network closes, and the missing `TextDecoder` flush. The web/test tsconfigs gained `vite/client` types.
- Published checkpoint: `6f276b2` (`6f276b22fbdf175f1030305f1567a3c6e56018fb`); evidence follow-up `2032832`.

### INC-09 — chat UI orchestration: complete, 2026-09-30

- Added `ChatProvider`, `useResponseStream` (bounded reconnect), `useSelectedConversation` (`?c=`) and the accessible components (list, messages, composer, Retry, status announcer).
- Review fixed stale cross-conversation results with a selection generation and per-conversation retained send keys, and added a `data:` favicon link. The evaluator accepted it after real-browser probes; the literal in-session browser pass was unavailable and is not claimed.
- Published checkpoint: `3396ed8` (`3396ed86ea3178a5950e211b9cb71e4103e717e1`).

### INC-10..INC-13 — automated tests: complete, 2026-10-05..2026-10-12

- INC-10 unit tests (14 files, 271 tests): `e840445`.
- INC-11 API integration, SQLite/restart and real-process tests (14 files, +93 tests): `a50aa08`.
- INC-12 SSE replay tests (5 files, +47 tests): `c7683df`.
- INC-13 React component/provider/hook tests (3 files, +26 tests): `cab37e1`.
- Totals at `cab37e1`: 36 files / 437 tests. Test-strength gaps found in review were closed in INC-12 and INC-13 and confirmed by evaluator mutants. No product change was needed in INC-10..INC-13.

### INC-14 — evidence, docs and close-out: implemented, awaiting independent final review, 2026-10-12

- Finalized `docs/experiment/EVIDENCE-MAP.md` (11 FRs, 26 ACs, evidence levels, limits L1–L7). Updated `ARCHITECTURE.md`, `ASSUMPTIONS.md` (A-007/009/011/012/013 resolved), `CODEMAP.md`, `TECHSTACK.md`, `TODO.md`, `README.md`, this file, the plan and the log.
- `docs/TODO.md` seed items closed: build order and jsdom (INC-00), run scripts (INC-00), API config/entrypoint/shutdown (INC-02/INC-07), web config (INC-08).
- The evidence map and living docs were not maintained per increment; this is recorded as a finding, not backdated.
- Disposable fresh clone of `cab37e1`: pinned `npm ci` and `npm run check` exit 0, 437 tests. The final docs commit still needs the evaluator's fresh-clone revalidation.
