# GOV-004 Evidence Manifest

## Identity

- Experiment ID: `GOV-004`
- Repository: `https://github.com/chamathsilva/rosetta-poc-chat`
- Immutable seed commit/tag: `c86f73ecc07b52033ed7342df61f783bb19a9c06` / `chat-seed-v1`
- Exact Session 1 prompt: `Implement the streaming chat application defined by docs/REQUIREMENTS.md and docs/ACCEPTANCE-CRITERIA.md. Follow the fixed technology boundary and treat every acceptance criterion as required.`
- Exact Session 2 prompt: `Continue the interrupted streaming-chat task. Before changing any code, report what was already completed, the current phase, and the next required action, with the repository files supporting each claim. Stop after the recovery report.`
- Invocation path: `/coding-flow`, displayed by Claude Code as `/rosetta:coding-flow`, in two separate processes
- Date and timezone: 2026-09-17 to 2026-09-18, America/Chicago

## Runtime

- Coding-agent host/version: Claude Code `2.1.276` for both task sessions; initialization began under `2.1.273`
- Model and requested effort: `claude-sonnet-5`, `medium`
- Actual effort evidenced by the session: `medium`
- Rosetta version/source commit/artifact hash: `3.1.13`; `35c65a046259700a63b4ba8281f711d34060563b`; Claude artifact SHA-256 `3fc9f6d10d879dfa5036378fbec1801cc69875b7ffea030f27d69eea6f4d7f1b`
- Installation and initialization path: already registered marketplace; fresh project-scoped `rosetta@rosetta` installation; verification; one-time initialization; reviewed initialization commit; fresh Session 1; fresh Session 2
- Permission, MCP, network, and hook posture: interactive `manual`; strict empty MCP configuration; Chrome/web tools disabled; no network required; `SessionStart` hook only

## Accepted Local Trajectory

- Initialization commit: `632e105b5f9734b61fc982e8f16350ce6965e360`
- Design commit: `cf6a4fff820478cf71a52b1b7b30c2b469bfc736`
- Specifications and plan commit: `8978437cbb885809b73ba611693aebca4a96d385`
- Interruption/checkpoint commit: `0057e227e8c3fc146786eae2603d3cd6d9fc5bac`
- Final accepted commit: `0057e227e8c3fc146786eae2603d3cd6d9fc5bac`
- Local-only archive ref: `refs/archive/gov-004-accepted-local`
- Git bundle SHA-256: `38c479e3921e0ff3105715b28a1824443ff5f863da3f57fbd8dde7087a2016db`
- Initialization transcript SHA-256: `f8186ce056a47ed79c0dfc5ad0b8c048832105549137c9162e10a2b40c087c34`
- Session 1 transcript SHA-256: `c9e564d52a5f656cbb789b95a65beacf1b34fc21194d93d5219282feb0265b7c`
- Session 2 transcript SHA-256: `d40cbc74e352d66ca261a516600ef0b8cbee7de639551a2e500bb0f17cfb6104`
- Ignored task-state snapshot SHA-256: `2422096895f08959de7f3ab9ceb15298d6b36e1da04831105608f368ed1b0b6a`

Private archive paths and raw transcript contents are intentionally not published.

## Public Result

- Branch: [`experiment/gov-004-accepted-run`](https://github.com/chamathsilva/rosetta-poc-chat/tree/experiment/gov-004-accepted-run)
- Immutable tag: [`gov-004-accepted-run-v1`](https://github.com/chamathsilva/rosetta-poc-chat/tree/gov-004-accepted-run-v1)
- Evidence branch: [`evidence/gov-004`](https://github.com/chamathsilva/rosetta-poc-chat/tree/evidence/gov-004/evidence/GOV-004) (sanitized report and manifest only)
- Public initialization commit: [`632e105b5f9734b61fc982e8f16350ce6965e360`](https://github.com/chamathsilva/rosetta-poc-chat/commit/632e105b5f9734b61fc982e8f16350ce6965e360)
- Public design commit: [`cf6a4fff820478cf71a52b1b7b30c2b469bfc736`](https://github.com/chamathsilva/rosetta-poc-chat/commit/cf6a4fff820478cf71a52b1b7b30c2b469bfc736)
- Public plan commit: [`8978437cbb885809b73ba611693aebca4a96d385`](https://github.com/chamathsilva/rosetta-poc-chat/commit/8978437cbb885809b73ba611693aebca4a96d385)
- Public checkpoint/final commit: [`0057e227e8c3fc146786eae2603d3cd6d9fc5bac`](https://github.com/chamathsilva/rosetta-poc-chat/commit/0057e227e8c3fc146786eae2603d3cd6d9fc5bac)
- Pull request: none

## Sanitization Mapping

| Accepted local commit | Public commit | Difference |
|---|---|---|
| `632e105b5f9734b61fc982e8f16350ce6965e360` | same | None; accepted commit was publication-safe |
| `cf6a4fff820478cf71a52b1b7b30c2b469bfc736` | same | None |
| `8978437cbb885809b73ba611693aebca4a96d385` | same | None |
| `0057e227e8c3fc146786eae2603d3cd6d9fc5bac` | same | None |

## Verification

- Clean install: `npm ci --ignore-scripts` passed under Node.js `24.21.0` and npm `11.6.2`
- Typecheck: passed for API, web, and shared workspaces
- Automated tests: command passed; no product test files exist in the seed or bounded recovery result
- Build: API, web, and shared workspace builds passed
- Independent probes: product/config diff against seed was empty; tracked tree clean; Session 2 report compared field-by-field with actual commits, files, ignored state, and Session 1 approval event
- Documentation/runtime comparison: final-approval persistence defect, ignored/stale state, residual M6 graph ambiguity, and one generated EOF whitespace issue recorded without repair
- Publication-tree privacy and identity scan: no credential-like values, private paths, unrelated identity strings, raw transcripts, or session IDs; all four experiment commits authored and committed by Chamath Silva
- Remote verification: public branch and tag both resolve to `0057e227e8c3fc146786eae2603d3cd6d9fc5bac`; remote `main` remains the seed commit; repository visibility is public
- Public-evidence boundary: sanitized report and manifest are on `evidence/gov-004`; the accepted-run branch/tag remain unchanged, and the private coordination repository is not exposed

## Artifact Inventory

### Public

- Code and generated repository artifacts: exact accepted initialization, architecture, specifications, and plan commits on the accepted-run branch
- Evidence report and sanitized trajectory: `evidence/GOV-004/README.md` and this manifest
- Test/review/validation evidence: summarized review findings, clean-install/check result, recovery comparison, and integrity hashes

### Local-only

- Raw initialization, Session 1, and Session 2 transcripts, permission restricted
- Complete-history Git bundle and `refs/archive/gov-004-accepted-local`
- Exact ignored `coding-flow-state.md` snapshot seen by Session 2

### Excluded

- `node_modules`, build outputs, TypeScript build metadata, host caches, and logs: reproducible or host-specific
- Raw transcripts and host session identifiers: private host metadata and unnecessary conversational detail
- Ignored task-state file from the public branch: absent from accepted Git history by workflow design; published only as a hash and analyzed in the report
- Time, token, cost, and productivity data: outside the study methodology

## Limitations

- Production-readiness status: not applicable; GOV-004 intentionally contains no product implementation
- Missing evidence: no clean-clone recovery attempt and no missing/corrupt-state variant; the fresh process reused the same working directory and therefore saw ignored files
- Result that must not be generalized: one partial recovery trajectory does not establish reliability across tasks, clean clones, models, hosts, Rosetta versions, or longer interruptions
