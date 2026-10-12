# EXP-002 — Streaming chat case-study result

2026-10-12, America/Chicago. Independent evaluator; no Rosetta association.
Integrity, runtime and publication mapping: [MANIFEST.md](MANIFEST.md).

## Outcome

The local, single-user streaming chat POC is implemented. Independent clean installation and the
complete check pass under Node24.21.0/npm11.6.2: product/test typecheck, **437 tests in 36 files**
and build. All11 functional requirements and25 application/evidence acceptance criteria pass with
the limits below. **AC-015 fails as a complete task-recovery claim:** separate governance tests
recovered technical planning but not reliable approval authority/current phase. The fixed completion
rule permits an explicitly failed criterion with explanation; it does not permit silently excluding it.

Functional acceptance is not full workflow conformance, security clearance or production readiness.
This is one reviewed trajectory with substantial evaluator intervention, not a productivity benchmark.

## Public implementation and coverage

- [Accepted code](https://github.com/chamathsilva/rosetta-poc-chat/tree/exp-002-accepted-run-v1):
  `b3960c317255624ae53014ba70cadb143858c9b5`.
- [All11FR/26AC evidence rows](https://github.com/chamathsilva/rosetta-poc-chat/blob/exp-002-accepted-run-v1/docs/experiment/EVIDENCE-MAP.md)
  connect implementation, named tests and evidence level for each fixed requirement/criterion.
- [Append-only experiment log](https://github.com/chamathsilva/rosetta-poc-chat/blob/exp-002-accepted-run-v1/docs/experiment/EXPERIMENT-LOG.md)
  records missed contracts, corrections, interruptions and deferred coverage.
- [Validation output and dependency audit](validation/inc14/README.md) preserve the original gates,
  not only this conclusion.

The test layers are shared/API units, real-SQLite container integration, loopback HTTP/SSE,
actual child-process restart/shutdown and React jsdom tests with stubbed fetch. Historical manual
browser observations supplement the UI cases; there is no automated browser/backend E2E suite.

## Corrections and observed friction

Claude authored product code and committed product tests in the Rosetta workflow. The evaluator
reviewed code/contracts, ran independent checks and disposable negative probes, required corrections,
maintained evaluation records and performed publication. Evaluator probes are not actor-authored tests.

Important captured findings include incomplete shared response schemas; an overly permissive
second-start event guard; leaking subscribers on throwing stream attachment; retrying while another
response is active; client response re-seeding, decoder flush and callback-error classification;
and stale asynchronous results crossing conversation selection. Corrections landed before the
corresponding implementation checkpoint was accepted. None is erased by final passing tests.

The test phase exposed fixture synchronization, unavailable matcher, assertion and TypeScript
failures. A passing runtime suite initially hid weak regression assertions: INC-12's dedupe mutant
survived47newtests, and INC-13 initially lacked pending-B and genuinely in-flight Retry assertions.
After Claude strengthened those cases, evaluator guard-removal/disabled-button mutants failed their
intended assertions. Separate synthetic-failure probes exercised teardown without timeout or
unhandled-error reports. Product code was unchanged during INC-10..13 test additions.

INC-13 disk exhaustion interrupted both test-file and native-transcript writes. The user freed
space; the same process resumed. A hash of retained records cannot prove that the missing interval
was captured. Host sleep, authentication expiry, clipped terminal prompts, manual approvals and
host-version drift are retained as execution observations, not chat defects or productivity metrics.

## Workflow conformance

| Required phase/artifact | Observed behavior and evidence | Assessment / attribution |
|---|---|---|
| Initialization and fresh task | Reviewed initialization commits, then separate task process and explicit `/rosetta:coding-flow` | Retained; setup evidence |
| Clarification/design/alternatives | Repository-grounded clarification and specifications; some architecture notes stayed ignored | Retained in part; portability limited |
| Design/plan review and approval | Planning reviewer did not return actionable output; evaluator review corrected load-bearing contracts before approved implementation | Combined; evaluator intervention, not independent Rosetta review success |
| Specification and implementation plan | Tracked SPECS/PLAN, ordered INC-00..14, used across interruptions | Retained; durable technical contract |
| Todo and canonical phase state | Tracked plan/log progressed; ignored workflow ledger remained stale at Phase7/INC-00 while tests later ran | Partial; artifact/state convention did not ensure current durable decisions |
| Implementation/build | Ordered actor-authored increments with pinned checks and separate evaluator probes | Retained; guided trajectory |
| Code review/implementation approval | Per-increment actor self-review and evaluator findings; manual approvals controlled writes | Combined; do not treat host tool consent as semantic product approval |
| Tests/test review | Four committed test increments plus independent mutant and cleanup probes | Retained after corrections; original partial judgments preserved |
| Final validation | Actor public-clone check at INC-13; evaluator clean final-publication-tree install/check | Retained; distinct checkpoints |
| Memory/completion updates | Living docs lagged code until INC-14; implementation summary stopped at INC-07; ignored ledger intentionally not repaired | Partial maintenance/currentness; final docs correction does not backdate compliance |

Evidence: accepted SPECS/PLAN, experiment log, evidence map and private native records represented by
integrity hashes. ENOSPC leaves a retention gap; full phase-by-phase transcript completeness is not claimed.

## Artifact quality

| Dimension | Final assessment |
|---|---|
| Source-grounded | Pass after review; shutdown-order and startup-error wording were corrected |
| Internally consistent | Pass for reviewed technical docs; canonical ignored workflow state remains contradictory |
| Actionable | Pass for running/building and technical navigation; approval recovery needs reconfirmation |
| Traceable | Pass: complete FR/AC map and correction log |
| Maintained | Partial: README, architecture, code map, assumptions and evidence map lagged several increments |
| Used | Pass: actor consulted committed plan/spec/log, including after compaction and prompt clipping |
| Authoritative | Partial: technical contracts are designated; approval/phase authority lacks one current tracked record |
| Durable/portable | Pass for tracked technical docs; fail for ignored canonical phase ledger |
| Current | Technical docs corrected at close-out; workflow-state freshness remains partial |

## Recovery and enforcement boundary

[GOV-004](https://github.com/chamathsilva/rosetta-poc-chat/blob/evidence/gov-004/evidence/GOV-004/README.md)
used a fresh process in the same worktree and conservatively trusted stale ignored approval state.
[GOV-004B](https://github.com/chamathsilva/rosetta-poc-chat/blob/evidence/gov-004b/evidence/GOV-004B/README.md)
used a clean public clone and inferred approval from plan narrative. Technical reconstruction passed,
but neither recovered the authorization boundary correctly. No governance artifacts were supplied
to the EXP-002 implementation actor; the evaluator reconciled this result only after it stopped.

Rosetta supplied workflow/instruction structure. Manual Claude permissions plus evaluator decisions
controlled covered writes. Pinned-runtime and clone isolation were evaluator/environment controls.
The evaluated frozen package registered SessionStart, not demonstrated deterministic recovery/edit
enforcement. No host-independent compliance or Rosetta-only causal attribution is established here.

## Limits and next work

- `npm audit` exits1: fast-uri and fastify moderate, source-map-js high. These are registry findings,
  not reproduced exploits or exposure assessments. Frozen dependencies were not updated.
- Config parsers and HTTP client lack dedicated tests; indirect/manual evidence is disclosed.
- Throwing SSE consumer callback has manual evidence but no automated regression assertion.
- Restart tests use seeded interrupted rows, not kill-mid-write or power-loss simulation.
- Complete event-data byte equality uses identical injected clocks/IDs, not arbitrary timestamps.
- Authentication, tenants, real LLMs, production deployment, migrations from a prior product schema,
  horizontal scaling, browser E2E and productivity measurements are outside this POC.
- Fresh install validates reproducibility, not a fresh agent's recovery of human decisions.

EXP-003 remains the next primary implementation study, from its untouched expense seed. Article1
is still an unpublished draft awaiting author/reviewer checks; no article is published by this close-out.
