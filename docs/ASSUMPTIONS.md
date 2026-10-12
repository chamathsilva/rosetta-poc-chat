# ASSUMPTIONS

Purpose: register of unverified assumptions and open unknowns, so no session silently treats a guess as fact.
Style: one h3 per entry: `A-nnn <topic> [OPEN|RESOLVED]`; fields Assumption, Confidence (High/Medium/Low), Basis, Resolve into (target doc updated once confirmed). On resolution: move the fact into the target doc, mark RESOLVED, replace Assumption with `Outcome (user, date)`, rename `Resolve into` to `Resolved into`; Confidence then reflects the pre-answer state. Never resolve by editing `docs/REQUIREMENTS.md`, `docs/ACCEPTANCE-CRITERIA.md`, `docs/EXPERIMENT-BOUNDARY.md`.

## Scope and Experiment

### A-001 Experiment log location [RESOLVED]
- Outcome (user, 2026-09-26): logs live in committed `docs/experiment/EXPERIMENT-LOG.md` and `docs/experiment/EVIDENCE-MAP.md`, created during the run.
- Confidence: Low. Basis: referenced by ACs, no file or path given.
- Resolved into: `docs/CONTEXT.md` (Experiment Rules).

### A-002 Interrupted response recovery action [RESOLVED]
- Outcome (user, 2026-09-27): on restart, a found non-terminal response is transitioned to `failed` (safe, redacted failure text) and offered the standard single retry; no separate "interrupted" UI status.
- Confidence: Low. Basis: AC-014 says "recoverable rather than silently completed" only.
- Resolved into: `docs/CONTEXT.md` (Response Lifecycle).
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §5.6 (Boot recovery); `plans/chat-poc/chat-poc-PLAN.md` INC-04/INC-07 exit checks, INC-11 test "restart turns an active response into `failed` + one terminal event, partial text retained" (AC-014).

### A-003 Replacement response is not retryable [RESOLVED]
- Outcome (user, 2026-09-27): confirmed; if the single replacement response also fails, no further retry is offered.
- Confidence: Medium. Basis: FR-008 "one retry"; non-goal "multiple retries".
- Resolved into: `docs/CONTEXT.md` (Domain Model).
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §3.4 (`classifyRetry` check order, rule 1); `plans/chat-poc/chat-poc-PLAN.md` INC-02 (`domain/retry.ts`), INC-10 (`apps/api/src/domain/*.test.ts`), INC-11 test "second retry returns the same replacement, one user message" (AC-017).

### A-004 Rosetta init artifacts belong to EXP-002 [RESOLVED]
- Outcome (user, 2026-09-26): confirmed; init files committed on experiment/EXP-002 as evidence.
- Confidence: High. Basis: `docs/EXPERIMENT-BOUNDARY.md` Seed contents + Contamination rules.
- Resolved into: `docs/CONTEXT.md` (Experiment Rules).

### A-005 GOV-004 tag is off-limits [RESOLVED]
- Outcome (user, 2026-09-26): confirmed; tag left in place, agents must never read/diff/checkout it.
- Confidence: High. Basis: tag name + boundary rule "do not copy ... between EXP-002 and GOV-004".
- Resolved into: `docs/CONTEXT.md` (Experiment Rules).

## Security and Privacy

### A-006 Log redaction scope [RESOLVED]
- Outcome (user, 2026-09-26): confirmed; IDs, lengths, status, error codes only; no message text.
- Confidence: Medium. Basis: FR-011 "without full message content", AC-021.
- Resolved into: `docs/ARCHITECTURE.md` (Intended, Operational).

### A-007 Config surface [RESOLVED]
- Outcome (approved SPECS §7.1/§7.2, implemented INC-02/INC-08; recorded INC-14, 2026-10-12): five API variables parsed fail-fast by Zod in `apps/api/src/config/env.ts`: `CHAT_DB_PATH` (default `./data/chat.sqlite`), `CHAT_API_PORT` (8787), `CHAT_API_HOST` (`127.0.0.1`), `CHAT_WEB_ORIGIN` (`http://localhost:5173`, the exact CORS origin) and `CHAT_LOG_LEVEL` (`info`). One web variable, `VITE_API_BASE_URL` (default `http://localhost:8787`), in `apps/web/src/config/env.ts`. No provider-selection variable exists.
- Confidence: Medium. Basis: FR-006, FR-010; no env config in seed.
- Resolved into: `docs/ARCHITECTURE.md` (Configuration).
- Verified by: `apps/api/src/http/routes/cors.test.ts` (configured origin); real-process `bootstrap/shutdown.test.ts` passes the §7.1 variables explicitly. Neither env parser has a dedicated test file (EVIDENCE-MAP limit L6).

## Behavior / UX

### A-008 Message normalization [RESOLVED]
- Outcome (user, 2026-09-27): confirmed; "normalized message" = trimmed content only; case and inner whitespace preserved as-is.
- Confidence: Low. Basis: FR-003/AC-003 use term without definition; FR-010 defines trim only.
- Resolved into: `docs/CONTEXT.md` (Glossary), EXP-002 tech spec.
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §3.1 (`normalizeContent`); `plans/chat-poc/chat-poc-PLAN.md` INC-01 (`domain-rules/normalize.ts`), INC-10 `normalize.test.ts` (whitespace-only/4000/4001/surrogate-pair cases, AC-019) and `deterministic-provider.test.ts` (byte-identical payloads, AC-003).

### A-009 Length rule applies after trim [RESOLVED]
- Outcome (approved SPECS §3.1, implemented INC-01; recorded INC-14, 2026-10-12): confirmed. Order is `normalizeContent` (exactly `String.prototype.trim`) → `checkContent` (empty, then more than 4000 code points) → persist, so the limit counts trimmed content in code points.
- Confidence: High. Basis: FR-010 order "Trim ...; reject empty ... and longer than 4000".
- Resolved into: `plans/chat-poc/chat-poc-SPECS.md` §3.1 and `packages/shared/src/domain-rules/normalize.ts`. `docs/CONTEXT.md` (Domain: "trimmed, max 4000 Unicode code points") already states the rule; it is outside INC-14's file list and was not edited.
- Verified by: `packages/shared/src/domain-rules/normalize.test.ts` (whitespace-only, 4000/4001, surrogate pairs; AC-019); `apps/api/src/http/routes/messages.test.ts`.

### A-010 Conversation summary fields [RESOLVED]
- Outcome (user, 2026-09-27): summary = id, title, updatedAt; title derived from the first user message (truncated), placeholder (e.g. "New conversation") until one exists; ordering by last update with deterministic tie-break.
- Confidence: Low. Basis: FR-001/FR-002 name "summaries" without fields.
- Resolved into: EXP-002 tech spec, `docs/CONTEXT.md`.
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §3.3 (`deriveConversationTitle`), §4.2 (`conversationSummarySchema`), §5.2 (ordering contract); `plans/chat-poc/chat-poc-PLAN.md` INC-01 (`domain-rules/title.ts`), INC-10 `title.test.ts`, INC-03 exit check + INC-11 test "identical timestamps keep list and history order" (AC-007).

## Technical

### A-011 Node built-in SQLite = `node:sqlite` [RESOLVED]
- Outcome (approved SPECS §5.1, implemented INC-03; recorded INC-14, 2026-10-12): confirmed. One long-lived synchronous `DatabaseSync` handle (`apps/api/src/persistence/db.ts`) with `journal_mode = WAL`, `foreign_keys = ON` and `busy_timeout = 5000`. Explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` in `unit-of-work.ts`. App-generated UUID ids, never `lastInsertRowid`. No npm SQLite package.
- Confidence: High. Basis: FR "Node's built-in SQLite module"; no SQLite package in `docs/DEPENDENCIES.md`.
- Resolved into: `docs/ARCHITECTURE.md` (Persistence), `docs/TECHSTACK.md`.
- Verified by: `apps/api/src/persistence/{schema,unit-of-work,ordering,repos}.test.ts`; real-process restart in `bootstrap/shutdown.test.ts`.

### A-012 Shared build order [RESOLVED]
- Outcome (approved SPECS §8.1, implemented INC-00; recorded INC-14, 2026-10-12): the risk was real and is fixed. api/web tsconfigs `reference` `packages/shared`; root `typecheck`/`build` run `tsc -b tsconfig.json` (dependency-ordered); `pretest` builds shared before Vitest. Each `npm run check` since INC-00 passes, including the INC-14 fresh clone at `cab37e1`.
- Confidence: Medium. Basis: package/tsconfig wiring; not executed.
- Resolved into: `docs/ARCHITECTURE.md` (Build and Scripts).
- Verified by: AC-001 (`npm ci && npm run check` in a disposable fresh clone, INC-14).

### A-013 Component test environment [RESOLVED]
- Outcome (approved SPECS §8.3, implemented INC-00; recorded INC-14, 2026-10-12): confirmed. `vitest.config.ts` defines two projects: `node` (api + shared tests) and `web` (`environment: "jsdom"`, `setupFiles: apps/web/test/setup.ts` with explicit `afterEach(cleanup)` and `ReadableStream`/`TextDecoder` presence guards).
- Confidence: High. Basis: `vitest.config.ts` has no `environment`.
- Resolved into: `docs/ARCHITECTURE.md` (Testing).
- Verified by: the five web test files (INC-10, INC-13) pass in the `web` project.

### A-014 No lint/format tool intended [RESOLVED]
- Outcome (user, 2026-09-27): confirmed no ESLint/Prettier; orphaned `.prettierignore` deleted (no Prettier installed, no AC requires linting).
- Confidence: Medium. Basis: no such deps; not a fixed technology.
- Resolved into: `docs/ARCHITECTURE.md`, `docs/TECHSTACK.md`.
- Verified by: not test-applicable (tooling decision, not runtime behavior); evidenced by the deleted `.prettierignore` and the absence of a lint step in `plans/chat-poc/chat-poc-SPECS.md` §8 / `npm run check` (AC-001).
