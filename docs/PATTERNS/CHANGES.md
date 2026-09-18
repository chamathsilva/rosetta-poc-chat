# PATTERNS CHANGES

## [2026-09-17] Created docs/PATTERNS/ (install mode) — extracted 2 structural/tooling patterns from chat-seed-v1
- Read docs/CODEMAP.md to scope extraction across apps/api, apps/web, packages/shared, and repo root.
- Read all package.json/tsconfig.json files (root + 3 members) and all 3 src/ entry-point files directly (repo is 29 source files total, well under the large-workspace threshold — no subagent fan-out needed).
- Confirmed via "would we rebuild this" / "found in 2+ places" tests: no functional/domain code patterns exist yet (apps/api and packages/shared are `export {}` stubs; apps/web renders a static placeholder). Did not fabricate controller/component/service/state-machine patterns to pad toward 10-15 — codebase does not support them yet.
- Created docs/PATTERNS/INDEX.md (2 pattern headers, grep-able, no tables), docs/PATTERNS/workspace-package-structure.md, docs/PATTERNS/seed-placeholder-module.md, and this CHANGES.md.
- Gap logged for Phase 8: no functional code patterns yet — this repo is a seed only; re-run pattern extraction once EXP-002 introduces real chat/API/streaming/persistence code.
