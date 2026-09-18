# TODO

Improvements and large deferred work items that do not belong in git history alone.
Not a sprint board and not a bug tracker — day-to-day issues go to GitHub Issues (see `gain.json`). This file holds work that a future session must not lose.
Each entry is an h3 header of the form `[priority] when — what — where`, with a body giving the detail and the reason.
Priorities: P0 blocking · P1 needed for acceptance · P2 improvement. Delete an entry once done; the change log lives in `agents/IMPLEMENTATION.md`.
Style: terse, grep-friendly, one entry per concern.

## Product implementation

### [P1] EXP-002/GOV-004 — implement FR-001..FR-011 — apps/api, apps/web, packages/shared

- The entire product is unbuilt. `docs/REQUIREMENTS.md` is the contract; `docs/ACCEPTANCE-CRITERIA.md` AC-001..AC-026 is the definition of done.
- Rough order implied by the dependency graph: shared Zod contracts → SQLite persistence + schema → deterministic provider → Fastify routes → SSE stream coordination and replay → React client state → refresh/reconnect/retry.
- Do not start ad hoc. Each experiment run begins from `chat-seed-v1` in a fresh session per `docs/EXPERIMENT-BOUNDARY.md`.

### [P1] before component tests — configure a jsdom test environment — vitest.config.ts

- jsdom and Testing Library are installed but `vitest.config.ts` sets no `environment`, so React component tests (AC-022, AC-018, AC-020) cannot run as-is.
- Node-side tests must keep the default environment; use a per-file environment directive or a project split rather than making everything jsdom.

### [P2] alongside first persistence work — add a configuration surface — apps/api

- FR-006 needs a configurable SQLite path and FR-010 a configured web origin; no loader, `.env`, or `.env.example` exists. Validate config with Zod at startup per FR-010.

## Documentation upkeep

### [P1] after first functional code lands — re-run pattern extraction — docs/PATTERNS/

- The current catalogue holds only structural conventions because the seed has no functional code; `INDEX.md` says so explicitly.
- Once routes, components, hooks, and services exist, extract the real recurring patterns and refresh `INDEX.md`.

### [P2] after each workstream — refresh generated docs — docs/CODEMAP.md, docs/DEPENDENCIES.md, agents/IMPLEMENTATION.md

- `CODEMAP.md` is generated (`./agents/TEMP/codemap.sh`, and `agents/TEMP/` is gitignored, so the script may be absent in a fresh clone — regenerate via SKILL `codemap`).
- `DEPENDENCIES.md` drifts as soon as a dependency is added; a new runtime dependency is also a technology-boundary question, not a routine change.

### [P2] GOV-004 — keep recovery-relevant decisions in committed files — docs/, agents/

- This branch tests what a memoryless session can recover from the repository. Any decision left only in conversation is lost experiment data.
- Before stopping work, confirm the open assumptions in `docs/ASSUMPTIONS.md` and the state in `agents/init-workspace-flow-state.md` are current.

## Template

### [P0|P1|P2] <when: milestone, trigger, or date> — <what to do> — <file or module>

- <Why it matters, what breaks without it, and any constraint on how it may be done.>
- <Reference the requirement (FR-xxx), criterion (AC-xxx), or doc that governs it.>
