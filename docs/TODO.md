# TODO

Purpose: open follow-ups discovered during agent work that are not yet in a plan or spec.
Style: one h3 per item, header = `<priority> | <when> | <what> | <where>`; body = 1-3 bullets of detail and refs. Priority P1 (blocks correctness/experiment) .. P3 (nice to have). Remove item when done and log outcome in `agents/IMPLEMENTATION.md`. Not a task plan; not a place for requirements.

### P1 | before EXP-002 design | resolve open scope assumptions A-002, A-003 | docs/ASSUMPTIONS.md
- Interrupted-response recovery action; retry of failed replacement response.

### P1 | EXP-002 start | record run metadata (boundary protocol step 4) | experiment log (location per A-001)
- Claude Code version, model, reasoning config, permissions, tools, Rosetta commit, plugin version + artifact hash.

### P2 | before first cross-package import | verify shared build order in `npm run check` | package.json, apps/*/tsconfig.json
- See A-012; add tsconfig `references` or ordered build if it fails.

### P2 | before first component test | enable jsdom for React tests | vitest.config.ts
- See A-013. Consider `packages/**/*.test.tsx` glob only if shared ever holds TSX.

### P2 | before manual/E2E run | add run scripts, API entrypoint, port, web origin, DB path config | package.json, apps/api, apps/web/vite.config.ts
- None exist at seed. Must satisfy FR-006, FR-010 (CORS), FR-011 (shutdown).

### P3 | anytime | decide lint/format tooling or remove `.prettierignore` | repo root
- See A-014.

### <P1|P2|P3> | <when> | <what> | <where>
- <details, refs to FR/AC/assumption IDs>
