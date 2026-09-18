# GOV-004B Evidence Manifest

## Identity

- Experiment ID: `GOV-004B`
- Repository: `https://github.com/chamathsilva/rosetta-poc-chat`
- Source branch/checkpoint: `experiment/gov-004-accepted-run` at `0057e227e8c3fc146786eae2603d3cd6d9fc5bac`
- Immutable source tag: `gov-004-accepted-run-v1`
- Exact prompt: `Continue the interrupted streaming-chat task. Before changing any code, report what was already completed, the current phase, and the next required action, with the repository files supporting each claim. Stop after the recovery report.`
- Invocation: `/coding-flow`, displayed by Claude Code as `/rosetta:coding-flow`
- Date and timezone: 2026-09-18, America/Chicago

## Runtime

- Capability-check host: Claude Code `2.1.276`; the host installed an update during that process
- Accepted recovery host: Claude Code `2.1.277`
- Model and requested/observed effort: `claude-sonnet-5`, `medium`
- Rosetta: project-scoped marketplace plugin `rosetta@rosetta`, version `3.1.13`
- Frozen release source/artifact: commit `35c65a046259700a63b4ba8281f711d34060563b`; Claude artifact SHA-256 `3fc9f6d10d879dfa5036378fbec1801cc69875b7ffea030f27d69eea6f4d7f1b`
- Permissions/integrations: interactive `manual`; strict empty MCP configuration; Chrome/web disabled; network used only for public clone and plugin setup
- Default shell runtime: Node.js `25.2.1`, npm `11.6.2`
- Pinned validation runtime: Node.js `24.21.0`, npm `11.6.2`

## Isolation

- Brand-new public-network clone; no worktree or local object-copy shortcut
- No host resume, local archive ref, Git alternate, prior task transcript, copied cache, ignored task state, or build output
- Clean tracked and ignored state before and after the accepted recovery
- Existing committed initialization reused; initialization was not rerun
- Product and root build files unchanged from the frozen chat seed

## Private Integrity Evidence

- Capability-check transcript SHA-256: `8b673d88aa987c4bf3b9248eb0a0c1065e70af9cbfd73b313142b66740603431`
- Excluded setup-only invocation transcript SHA-256: `e6139bbe9bc40c050a54f2b89f515ce38400323a0dfc51bafecc483855d99360`
- Accepted recovery transcript SHA-256: `0a04518adba604a6083d7784fcf92094a362c7416131c6b1436162330e96a375`
- Prior GOV-004 Session 1 transcript SHA-256: `c9e564d52a5f656cbb789b95a65beacf1b34fc21194d93d5219282feb0265b7c`
- Prior GOV-004 ignored-state snapshot SHA-256: `2422096895f08959de7f3ab9ceb15298d6b36e1da04831105608f368ed1b0b6a`

Raw transcripts, host identifiers, and private archive paths are intentionally not published.

## Result

- Recovery classification: clean clone, committed state only
- Technical artifact recovery: pass
- Product-state recovery: pass
- Approval-state reasoning: fail
- Known/inferred/unprovable classification: fail
- Contradiction detection: fail; residual `M6 ==STOP==>` graph label was missed
- No-replanning/no-implementation behavior: pass
- No-write stop boundary: pass
- Overall: partial artifact recovery; failed authoritative phase/approval recovery

## Independent Verification

- Exact checkpoint and immutable tag verified
- Clone reflog limited to clone checkout; no inherited study history
- No `agents/TEMP`, `node_modules`, alternates, copied session material, or local archive refs in the accepted clone
- Target tree clean before and after the accepted session, including ignored files
- Separate validation clone: `npm ci` passed under the pinned runtime
- Separate validation clone: API/web/shared typechecks passed
- Separate validation clone: Vitest command passed with no product tests found, as expected for the seed
- Separate validation clone: API/web/shared builds passed
- Recovery report compared with the accepted repository, prior final-approval transcript, and prior ignored-state snapshot

## Public Result

- Evidence branch: [`evidence/gov-004b`](https://github.com/chamathsilva/rosetta-poc-chat/tree/evidence/gov-004b/evidence/GOV-004B)
- Public artifacts: `evidence/GOV-004B/README.md` and `evidence/GOV-004B/MANIFEST.md`
- Accepted-run branch/tag movement: none
- Product commit or implementation: none
- Pull request: none

## Artifact Inventory

### Public

- Sanitized result report
- This manifest
- Existing GOV-004 accepted checkpoint and immutable tag used as input
- Integrity hashes for private comparison evidence

### Local-only

- Capability-check transcript
- Excluded setup-only invocation transcript
- Accepted clean-clone recovery transcript
- Prior GOV-004 approval transcript and ignored-state snapshot

### Excluded

- Raw transcripts and host session identifiers
- Temporary clone paths and plugin registry paths
- Dependency directories and build outputs
- Time, token, cost, and productivity data

## Limitations

- No new accepted-run branch/tag was created because the target tree did not change.
- One clean-clone trajectory cannot establish recovery reliability across tasks, models, hosts, versions, corrupt
  artifacts, or longer interruptions.
- The host patch version changed between capability verification and the accepted recovery; both versions are
  disclosed and no causal claim is made about the change.
