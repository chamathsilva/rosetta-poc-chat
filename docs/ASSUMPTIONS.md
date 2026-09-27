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

### A-007 Config surface [OPEN]
- Assumption: DB path, web origin (CORS), API port are env-configured and runtime-validated; names/defaults undecided.
- Confidence: Medium. Basis: FR-006, FR-010; no env config in seed.
- Resolve into: `docs/ARCHITECTURE.md`.

## Behavior / UX

### A-008 Message normalization [RESOLVED]
- Outcome (user, 2026-09-27): confirmed; "normalized message" = trimmed content only; case and inner whitespace preserved as-is.
- Confidence: Low. Basis: FR-003/AC-003 use term without definition; FR-010 defines trim only.
- Resolved into: `docs/CONTEXT.md` (Glossary), EXP-002 tech spec.
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §3.1 (`normalizeContent`); `plans/chat-poc/chat-poc-PLAN.md` INC-01 (`domain-rules/normalize.ts`), INC-10 `normalize.test.ts` (whitespace-only/4000/4001/surrogate-pair cases, AC-019) and `deterministic-provider.test.ts` (byte-identical payloads, AC-003).

### A-009 Length rule applies after trim [OPEN]
- Assumption: 4000 code-point limit counts trimmed content.
- Confidence: High. Basis: FR-010 order "Trim ...; reject empty ... and longer than 4000".
- Resolve into: `docs/CONTEXT.md`.

### A-010 Conversation summary fields [RESOLVED]
- Outcome (user, 2026-09-27): summary = id, title, updatedAt; title derived from the first user message (truncated), placeholder (e.g. "New conversation") until one exists; ordering by last update with deterministic tie-break.
- Confidence: Low. Basis: FR-001/FR-002 name "summaries" without fields.
- Resolved into: EXP-002 tech spec, `docs/CONTEXT.md`.
- Verified by: `plans/chat-poc/chat-poc-SPECS.md` §3.3 (`deriveConversationTitle`), §4.2 (`conversationSummarySchema`), §5.2 (ordering contract); `plans/chat-poc/chat-poc-PLAN.md` INC-01 (`domain-rules/title.ts`), INC-10 `title.test.ts`, INC-03 exit check + INC-11 test "identical timestamps keep list and history order" (AC-007).

## Technical

### A-011 Node built-in SQLite = `node:sqlite` [OPEN]
- Assumption: persistence uses `node:sqlite` (synchronous API) in Node 24.21.0; no npm SQLite package.
- Confidence: High. Basis: FR "Node's built-in SQLite module"; no SQLite package in `docs/DEPENDENCIES.md`.
- Resolve into: `docs/ARCHITECTURE.md`, `docs/TECHSTACK.md`.

### A-012 Shared build order [OPEN]
- Assumption: once api/web import shared, `npm run check` needs shared built first (exports point at `dist`; no tsconfig `references` from api/web).
- Confidence: Medium. Basis: package/tsconfig wiring; not executed.
- Resolve into: `docs/ARCHITECTURE.md` (Known Wiring Risks).

### A-013 Component test environment [OPEN]
- Assumption: jsdom must be enabled (config or per-file) for React tests; Vitest default is node.
- Confidence: High. Basis: `vitest.config.ts` has no `environment`.
- Resolve into: `docs/ARCHITECTURE.md` (Testing).

### A-014 No lint/format tool intended [RESOLVED]
- Outcome (user, 2026-09-27): confirmed no ESLint/Prettier; orphaned `.prettierignore` deleted (no Prettier installed, no AC requires linting).
- Confidence: Medium. Basis: no such deps; not a fixed technology.
- Resolved into: `docs/ARCHITECTURE.md`, `docs/TECHSTACK.md`.
- Verified by: not test-applicable (tooling decision, not runtime behavior); evidenced by the deleted `.prettierignore` and the absence of a lint step in `plans/chat-poc/chat-poc-SPECS.md` §8 / `npm run check` (AC-001).
