# EXP-002 evidence manifest

## Identity and runtime

- Repository: `chamathsilva/rosetta-poc-chat`.
- Immutable seed: `chat-seed-v1`, `c86f73ecc07b52033ed7342df61f783bb19a9c06`.
- Exact task: “Implement the streaming chat application defined by docs/REQUIREMENTS.md and docs/ACCEPTANCE-CRITERIA.md. Follow the fixed technology boundary and treat every acceptance criterion as required.”
- `/coding-flow` rendered as `/rosetta:coding-flow`; initialization request was “Initialize this repository using the respective Rosetta workflow”.
- Setup2026-09-26; planning2026-09-27; implementation/checkpoint close-out through2026-10-12, America/Chicago.
- Requested `claude-sonnet-5`, medium. Implementation later observed `claude-opus-5-5`, UI medium/manual.
- Planning native host2.1.274 versus external preflight2.1.283; later recorded host progression2.1.283/284/285/287. Final running host2.1.287 differs from installed shell binary2.1.296. Update notices are not proof of a running-process update.
- Frozen full project-scoped `rosetta@rosetta`3.1.13, source `35c65a046259700a63b4ba8281f711d34060563b`.
- Frozen artifact filename `core-claude-3.1.13-2026-09-15.zip`; manifest identifies full Rosetta, not a light package. SHA256 `3fc9f6d10d879dfa5036378fbec1801cc69875b7ffea030f27d69eea6f4d7f1b`.
- Marketplace/install/capability/init/review/fresh-task path used. Manual one-time permissions, project settings, strict empty MCP, Claude Chrome/web disabled. Evaluator browser probes were separate.
- Shipped frozen hook posture: SessionStart only. Product provider requires no external credentials/network. Clone/install/audit/publication network is distinct from product runtime network.
- Claude account remained unchanged; Git/GitHub was `chamathsilva`, Chamath author/committer, SSH alias `chamath`. Exact Claude identifiers stay private.
- Recovery was saved-conversation/same-worktree continuation, including new processes and final same-process automatic compaction; not portable fresh-agent approval recovery.

## Accepted local trajectory and archive

- Actor initialization `290b2df9d950ed87f6736263f4dc29d3ad7b3e42`; formatting-only evaluator setup `170f64403213c2b8c9ae1053106054c4d9b7dfdf`.
- Planning checkpoint `e16cb0a6890f88ef3f207878f4419ffffa83997e`.
- Final product/test checkpoint `cab37e175f2916c841068030efd1ac0f0ff9828b`.
- Reviewed docs/evaluator criterion reconciliation `a8b64d494258fbce5e39d7172b91151674157280`, published on original `experiment/EXP-002`.
- Local-only ref `refs/archive/exp-002-accepted-local` points at that reviewed commit. Complete-history bundle verified.
- Bundle SHA256 `555b69b251aee3628a3b56ae05f495f96d8e85064967414a8ba8e51bd9d074f9`.
- Final captured continuation transcript SHA256 `3803911f07d7598a9f03199fa19b26d34bd66f4baa748246efbdb9a9a7c277b6`.
- Earlier initialization transcript SHA256 `94bf928c797709e87dc57d6d85eb569f828f2f90cd333f8e35e5b9af4e5e5ba7`; planning transcript SHA256 `9b6de9fa5f883179c4afb4e44ef7308c32945fb3b9dbd1ed60cfd1180b151f64`.
- Permission-restricted archive is durable local ignored storage, not dependent solely on temporary system directories. No private archive location or raw transcript is public.
- Canonical workflow ledger is ignored/stale; last ledger phase does not prove final approval. Tracked PLAN/log record increment acceptance, not a complete portable semantic-approval event stream. ENOSPC transcript gap remains despite hashes.

## Public result and mapping

- [Accepted branch](https://github.com/chamathsilva/rosetta-poc-chat/tree/experiment/exp-002-accepted-run), immutable [tag](https://github.com/chamathsilva/rosetta-poc-chat/tree/exp-002-accepted-run-v1).
- Public final commit `b3960c317255624ae53014ba70cadb143858c9b5`, parent immutable seed. No separate public initialization/checkpoint commits in the sanitized aggregate history.
- [Public evidence](https://github.com/chamathsilva/rosetta-poc-chat/tree/evidence/exp-002/evidence/EXP-002), [report](https://github.com/chamathsilva/rosetta-poc-chat/blob/evidence/exp-002/evidence/EXP-002/RESULTS.md).
- No pull request or merge. Main/seed/governance refs are not moved.

| Accepted local commit | Public commit | Difference |
|---|---|---|
| seed `c86f73e` | same seed | unchanged |
| initialization/planning/INC-00..14 through `a8b64d4` | aggregate `b3960c3` | history reconstructed from seed; original sequence retained in verified private bundle and original public experiment branch |

Final-tree comparison changes exactly one sentence in `docs/experiment/EXPERIMENT-LOG.md`: literal
author runtime path becomes “prepended the pinned Node24.21.0 binary directory to PATH”. No product,
test, schema, package, lockfile or settings delta. It is not byte-identical history/tree. Synthetic
`/Users/dev/...` redaction fixtures are intentionally unchanged. Earlier original public experiment
commits already contained the author runtime path; they were not force-rewritten by this publication.

## Verification and inventory

- Actor fresh public clone at `cab37e1`: no tags, copied dependencies or ignored state; `npm ci`0, check0.
- Evaluator newly isolated final publication checkout at `b3960c3`: no copied dependencies; `npm ci`0,
  check0, product/test typecheck,437tests/36files and build, clean tracked tree afterward.
- Mutation/cleanup probes from accepted INC-11..13 reused because tree comparison proves unchanged product/tests.
- All11FR/26AC reviewed;25AC pass with limits, AC-015 explicitly failed with separate recovery evidence.
- Privacy/identity scans cover intended reachable publication commits and file inventory plus manual review.
  No real account path, wrong identity, credential, private key, raw transcript or third-party account identifier
  found in the final accepted history. Pattern scans are supplements, not proof of absence of secrets.
- [Validation logs, audit and hashes](validation/inc14/README.md) are public, sanitized where needed.
- `npm audit`1, two moderate/one high affected packages; no automatic dependency fix.
- Public: code/tests/tracked plans/context/log/map, report, manifest and selected sanitized verification output.
- Private: native transcripts, original history bundle, ignored workflow state, earlier raw probes/caches.
- Excluded: credentials, keys/cookies, account identifiers, databases, dependency/build/cache directories,
  raw UI screenshots/transcripts, unrelated source-repository changes, hidden evaluation protocols/prompts.
- Security review limits, seeded-not-power-loss recovery, jsdom-vs-browser, missing dedicated/callback tests,
  approval-state failure, host drift, evaluator intervention and transcript gap are explained in RESULTS.
- Not production-ready; no time/token/cost/productivity measurements or universal Rosetta claims.
