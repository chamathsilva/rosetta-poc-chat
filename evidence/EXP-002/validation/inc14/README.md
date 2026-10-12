# INC-14 validation

2026-10-12, America/Chicago. Claude's isolated public clone at
`cab37e175f2916c841068030efd1ac0f0ff9828b` used `--single-branch --no-tags`.
No dependencies, ignored state or raw transcripts were copied into it.
Pinned Node24.21.0/npm11.6.2: `npm ci` exit0; `npm run check` exit0,
437 tests/36files, typecheck and build pass. Logs preserve generated output;
local target/pinned-runtime roots are replaced where present.

Independent `npm audit --json` exit1 reports fast-uri and fastify (moderate)
and source-map-js (high). No exploit or exposure assessment, dependency update
or production-security clearance is claimed.

The `claude-fresh-*` outputs validate INC-13's commit only. The separate
`independent-final-*` outputs validate the final sanitized publication checkout at
`b3960c317255624ae53014ba70cadb143858c9b5`: fresh pinned `npm ci` exit0,
`npm run check` exit0, 437tests/36files, product/test typecheck and build pass.
No dependencies or ignored state were copied; the tracked tree remained clean.
The only accepted-local/public delta is one documentation metadata sentence,
so prior bounded product/test mutation probes remain applicable.

`SHA256SUMS` contains root-relative paths; run `shasum -a 256 -c
evidence/EXP-002/validation/inc14/SHA256SUMS` from the repository root.
Generated output retains its original whitespace and test timing fields; no
productivity/time/token/cost conclusion is derived from them. Prose/JSON
whitespace checks are separate from literal generated-output preservation.
