# ASSUMPTIONS

Open assumptions and unknowns carried by this workspace, so no session silently re-invents an answer.
Each entry: the assumption, a confidence level (high | medium | low), and the target file that records the answer once resolved.
Resolve by asking the human or by evidence in code — then move the fact to the target file and mark the entry RESOLVED here.
Style: one h3 per assumption, three fields, no prose. Loaded in every AI session — keep it short; delete resolved entries once the target file carries the fact.

## Workspace and documentation

### Pattern catalogue is structural only, because no functional code exists [RESOLVED]

- Confirmed by the human, 2026-09-17: expected outcome for a placeholder seed. Re-run pattern extraction once EXP-002/GOV-004 introduces functional code. Tracked as a TODO in `docs/TODO.md`.

### Rosetta-generated docs are subordinate to the seed governance docs [ACTIVE]

- Assumption: where `docs/CONTEXT.md` / `docs/ARCHITECTURE.md` and `docs/REQUIREMENTS.md` / `docs/ACCEPTANCE-CRITERIA.md` / `docs/EXPERIMENT-BOUNDARY.md` disagree, the seed docs win and the Rosetta doc is the defect.
- Confidence: high — stated in `docs/EXPERIMENT-BOUNDARY.md` (criteria fixed before a run; changes require a recorded study deviation).
- Target when resolved: no change expected; contradiction found → fix the Rosetta doc, never the seed doc.

### Adding Rosetta artifacts to this branch does not violate the seed-purity rule [RESOLVED]

- Confirmed by the human, 2026-09-17: compliant — the prohibition targets seed creation, not post-tag experiment branches. Recorded in `docs/CONTEXT.md` → "Contamination rules". Generated docs are to be committed on `experiment/GOV-004`.

## Product and technical unknowns

### No test environment is configured for browser-side tests [RESOLVED]

- Confirmed by the human, 2026-09-17: a normal config gap, deferred to implementation, not a study deviation (fixed tech — Vitest + Testing Library — is unchanged, just unconfigured). Tracked as a TODO in `docs/TODO.md`.

### SQLite access is via `node:sqlite`, unversioned by the requirements [ACTIVE]

- Assumption: "Node's built-in SQLite module" means `node:sqlite` on Node 24.21.0, accepting its experimental status, with no wrapper library permitted.
- Confidence: high — `REQUIREMENTS.md` fixes the built-in module and `DEPENDENCIES.md` shows no SQLite package installed.
- Target when resolved: `docs/ARCHITECTURE.md` → persistence; record the concrete import in `docs/PATTERNS/` once written.

### Response-event ordering mechanism is unspecified [ACTIVE]

- Assumption: the response-scoped monotonically increasing event `id` (FR-004) and the timestamp-independent message ordering (FR-006, AC-007) will both be satisfied by a stored integer sequence, not by autoincrement rowids shared across responses.
- Confidence: medium — requirements fix the observable property, not the mechanism.
- Target when resolved: `docs/ARCHITECTURE.md` → stream coordination.

### Configuration surface is undefined [ACTIVE]

- Assumption: the configurable SQLite path (FR-006) and configured web origin (FR-010) come from validated environment variables; names, defaults, and whether a `.env` file is used are not yet decided, and no `.env.example` exists.
- Confidence: low — no configuration file or loader is present anywhere in the seed.
- Target when resolved: `docs/ARCHITECTURE.md` → boundaries and safety.
- Human decision, 2026-09-17: defer the actual values to implementation; tracked as a TODO in `docs/TODO.md`. Kept ACTIVE — the surface itself is still undecided.

### No CI, linting, or formatting enforcement exists [RESOLVED]

- Confirmed by the human, 2026-09-17: intentional for the disposable POC seed; `npm run check` is the whole quality gate for now. Lint/CI setup, if any, belongs to the EXP-002/GOV-004 implementation phase.

### gain.json SDLC fields are mostly unfilled placeholders [RESOLVED]

- Confirmed by the human, 2026-09-17: genuinely unused for this disposable POC. Placeholders remain verbatim in `gain.json` by design.
