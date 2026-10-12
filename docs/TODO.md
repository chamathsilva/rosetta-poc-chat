# TODO

Purpose: open follow-ups discovered during agent work that are not yet in a plan or spec.
Style: one h3 per item, header = `<priority> | <when> | <what> | <where>`; body = 1-3 bullets of detail and refs. Priority P1 (blocks correctness/experiment) .. P3 (nice to have). Remove item when done and log outcome in `agents/IMPLEMENTATION.md`. Not a task plan; not a place for requirements.

The three seed items (shared build order, jsdom for React tests, run scripts/entrypoint/config) were done in INC-00 (build order, jsdom, `dev:api`/`dev:web`), INC-02/INC-07 (API config, entrypoint, shutdown) and INC-08 (web config), and were removed in INC-14 (2026-10-12); outcomes are in `agents/IMPLEMENTATION.md`. They had stayed listed after completion, another instance of the maintenance gap recorded in `docs/experiment/EXPERIMENT-LOG.md` (INC-14).

### P2 | after EXP-002 acceptance | review `npm audit` findings | package-lock.json
- INC-14's fresh-clone `npm ci` reported 3 vulnerabilities (2 moderate, 1 high); not triaged. Dependencies are fixed technology: any change needs a recorded study deviation.

### P3 | if test coverage is extended | test a throwing SSE consumer callback | apps/web/src/api/sse-client.ts
- Limit L1 in `docs/experiment/EVIDENCE-MAP.md`: the deliberate rethrow surfaces as a Vitest unhandled error, so it is untested.

### P3 | if test coverage is extended | dedicated tests for env parsers and HTTP client | apps/api/src/config/env.ts, apps/web/src/config/env.ts, apps/web/src/api/http-client.ts
- Limit L6: covered only indirectly (real-process tests, provider/App tests, INC-08 manual validation).

### P3 | if real-browser evidence is required | automated browser E2E | apps/web
- Limit L3: UI evidence is jsdom plus manual real-browser observations; no browser runner is installed.
