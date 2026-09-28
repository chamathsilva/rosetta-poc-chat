# Experiment Log (AC-026)

Purpose: record every missed requirement, manual correction, unexpected change, or deliberately deferred item during `EXP-002`, per `docs/CONTEXT.md` Experiment Rules and the Completion rule in `docs/ACCEPTANCE-CRITERIA.md`. Append-only; one h3 entry per event, in chronological order. Never edit a past entry's facts — add a follow-up entry instead.

Style: `### <YYYY-MM-DD> | <category> | <one-line summary>`, body = what happened, why, and the resulting state. Category is one of `missed-requirement`, `manual-correction`, `unexpected-change`, `deferral`.

## Entries

### 2026-09-27 | unexpected-change | Stray permission-menu input during INC-00 checkpoint review

A bare `4` arrived mid-turn while the orchestrator was inspecting git status/config/remote for the INC-00 checkpoint, with no pending question from the assistant it could answer. Treated as unintentional (e.g. stray terminal/menu input) and not acted on; flagged to the user, work continued on the directed checkpoint task.

### 2026-09-27 | unexpected-change | INC-01 stopped before writing any file, to honor "INC-00 must land alone"

User directed: land and checkpoint (commit + push) INC-00 alone before INC-01 starts, per `plans/chat-poc/chat-poc-PLAN.md` governing rule 8. The orchestrator had already dispatched an engineer subagent for INC-01; it was still reading spec sections and had written no files under `packages/shared/src`. Stopped via `TaskStop` before any write. `git status` confirmed no `packages/shared/src` changes existed at stop time. INC-01 will be redispatched fresh after the INC-00 checkpoint is committed and pushed, and the push is verified against the remote.

### 2026-09-27 | manual-correction | INC-00 implemented and independently verified

INC-00 (seed toolchain fixes — `plans/chat-poc/chat-poc-PLAN.md` INC-00, `plans/chat-poc/chat-poc-SPECS.md` §8.1-§8.3) implemented by an engineer subagent, all commands under pinned Node 24.21.0. Orchestrator independently re-ran a clean-tree `npm run check` (exit 0, zero product tests present) and reviewed every changed file's diff line-by-line against SPECS §8.1/§8.2/§8.3 — no deviation found. `AC-001` marked `Passed` in `docs/experiment/EVIDENCE-MAP.md` with the exact file list as evidence.

Follow-up (same day, after this entry was first written): committed standalone as `a20c0bb` on `experiment/EXP-002` (parent `e16cb0a`, the planning checkpoint), pushed to `origin/experiment/EXP-002`, and independently verified via `git ls-remote origin refs/heads/experiment/EXP-002` — remote tip `a20c0bbedd518154fb343556e9bd9e84b056ab2c` matches local HEAD exactly. No other increment's files were included in this commit.

### 2026-09-27 | manual-correction | title.ts had an intra-layer import; SPECS §2 requires domain-rules/* to depend on nothing

INC-01's first draft of `packages/shared/src/domain-rules/title.ts` imported `codePointLength` from `./normalize.ts` (both zero-IO, zero-zod) to avoid duplicating code-point-counting logic, reasoning this satisfied SPECS §2's "no zod, no IO" wording. User rejected: SPECS §2 says `domain-rules/*` "depend on nothing," full stop, and the plan's governing rules 1-2 keep the approved layout fixed and make SPECS the contract source, not to be re-decided mid-implementation — even to relax an ambiguity in the requester's favor.

Fix: `title.ts` now has a private, unexported, file-local `titleCodePoints` helper (`Array.from`-based) instead of importing from `normalize.ts`. Zero imports confirmed via `grep -n "^import" packages/shared/src/domain-rules/*.ts`. Small, accepted duplication of a two-line code-point-counting expression between `normalize.ts` and `title.ts`, traded for literal compliance with a fixed spec rule rather than an orchestrator-favorable reinterpretation of it. Re-ran the full INC-01 exit check afterward — still green.

### 2026-09-27 | manual-correction | INC-01 contract surface was incomplete; execution-discovered spec gap (health.ts)

User-led independent review of the completed INC-01 work found the "all 7 contracts files" claim in the subagent's report (echoed into `docs/experiment/EVIDENCE-MAP.md`) was inaccurate: only 6 files existed. Audit of every schema/body explicitly named (via `xSchema = ...`) in `chat-poc-SPECS.md` §4.1-§4.3 and §4.6 against actual exports found 3 gaps:

1. `createConversationRequestSchema` (§4.3, `POST /api/conversations`) — missing. Fixed: added to `contracts/conversation.ts` (§2.1 already said this file holds "create/list bodies").
2. `retryAcceptedSchema` (§4.3, `POST /api/responses/:responseId/retry`) — missing. Fixed: added to `contracts/response.ts` (natural fit, response-retry-related).
3. `healthResponseSchema` (§4.3, `GET /health`) — missing, and unlike the other two, no existing file in the fixed §2.1 layout (conversation/message/response/events/errors/params) fits it without stretching that file's stated scope.

For (3), the orchestrator's first instinct was to place it in the existing `contracts/errors.ts` to avoid touching the fixed module layout (plan governing rule 1). The user explicitly overrode this and gave direct orchestrator approval to add a 7th module instead — judged the cleaner root-cause fix, and the one that reconciles the SPECS TLDR's pre-existing "7 files" line (which was correct all along; the §2.1 layout *tree* was the buggy, incomplete part, missing a `contracts/health.ts` row).

Resolution: created `packages/shared/src/contracts/health.ts` (`healthResponseSchema`), barrel-exported it, updated `chat-poc-SPECS.md` §2.1's layout tree to list `contracts/health.ts`, and updated `chat-poc-PLAN.md` INC-01's file list to include it and name all three previously-missing schemas explicitly. Full INC-01 exit check re-run after all three additions — still green (see below).

This is an execution-discovered specification correction (the fixed §2.1 layout was itself incomplete, not something INC-01 mis-implemented against a correct spec), authorized by the orchestrator per the user's explicit direction, not a unilateral spec change.

### 2026-09-27 | manual-correction | Three §4.3 response bodies were left unnamed; found missing on a further independent pass

A second independent review pass (user-led) found the orchestrator had stopped short: `chat-poc-SPECS.md` §4.3 gives 5 request/response bodies an explicit `xSchema = ...` name in its table, but leaves 3 response shapes inline/unnamed — `POST /api/conversations` success (`{ conversation }`), `GET /api/conversations` success (`{ conversations: ConversationSummary[] }`), `GET /api/conversations/:conversationId` success (`{ conversation, messages, responses, activeResponse }`). The orchestrator's earlier reasoning — that "unnamed in the table" meant "not required as a shared schema" — was wrong: SPECS §2.1 already said `conversation.ts` owns "create/list bodies" (response bodies, not just the one named request body), and AC-004/the §4 preamble ("Response bodies are parsed on the client as well as produced on the server") require a single shared definition for every body, not only the 5 the table happened to name.

Fix: added `createConversationResponseSchema`, `listConversationsResponseSchema`, `getConversationResponseSchema` to `packages/shared/src/contracts/conversation.ts` (shapes exactly as SPECS §4.3 states; export names are an implementation choice, flagged in the file's own header comment for review since the spec text never assigned them names). `getConversationResponseSchema` required `conversation.ts` to import `messageSchema`/`responseSchema` — checked for import cycles first (`message.ts`/`response.ts` do not import `conversation.ts`; the dependency graph stays a DAG). Updated `chat-poc-SPECS.md` §4.3's table to show the three new names instead of bare inline shapes, so INC-06/INC-08 have an unambiguous name to import. Full INC-01 exit check re-run after this addition — still green.

No new module was added this time (governing rule 1 untouched) — these three land inside `conversation.ts`, which §2.1 already designated for exactly this content.

Follow-up (same day): INC-01 was committed standalone as `e3900d5` (`e3900d536d0ccc292b2134f8eafc74871705deca`) on `experiment/EXP-002`, pushed to `origin/experiment/EXP-002`, and independently verified with `git ls-remote`; the remote tip matched local HEAD exactly. The worktree was clean after the push. The plan header was then corrected from its stale pre-implementation status to record INC-00/INC-01 complete and INC-02 next.

### 2026-09-27 | manual-correction | Five defects found by user-led review of chat-poc-SPECS.md/PLAN.md

User reviewed `plans/chat-poc/chat-poc-SPECS.md`/`chat-poc-PLAN.md` directly (Phase 5, user-led) and identified 5 defects, all corrected before any implementation:

1. **Send `202` returned IDs only.** `sendMessageAcceptedSchema` returned `{conversationId, userMessageId, responseId}`; a client had to make a follow-up `GET` to render anything. Fixed to `{conversationId, userMessage, response}` (full objects) — SPECS §4.3, §4.4.
2. **`response.completed` event returned `assistantMessageId`+`text` only, not the full message.** Fixed to embed the full `assistantMessage` (Message row). Noted tradeoff: this reintroduces a `createdAt` field into the payload, so AC-003 byte-for-byte comparison now explicitly requires the same injected `Clock` across both compared runs (already true of every AC-003 test) — SPECS §6.2, §9.4.
3. **Boot recovery assumed every active response already had a `response.started` event.** A response that crashed between insert and its first event (`status="pending"`, zero events) would violate `checkAppend`'s "seq 1 must be `response.started`" rule if `response.failed` were appended directly. Fixed: zero-event case atomically appends `response.started`(1) then `response.failed`(2); partial-stream case appends only `response.failed`. Two separate named tests planned (INC-11) — SPECS §5.6.
4. **Nothing enforced one active response per conversation.** A second message could be sent while the first's response was still `pending`/`streaming`. Fixed: new DB partial unique index `ux_responses_one_active_per_conversation`, new domain gate `checkActiveResponseGate` (evaluated only after idempotency classification, so a replay of the send that owns the active response still succeeds), new `409 RESPONSE_ALREADY_ACTIVE` error code, composer disables Send while any response is active. Named test planned (INC-11) — SPECS §3.4a, §5.2, §5.5, §4.6, §9.6.
5. **Shutdown aborted runners but never awaited their settle before closing the DB.** Risk: closing `node:sqlite` while an aborted runner's write is still in flight. Fixed: runner registry now holds `{controller, promise}` pairs; shutdown awaits `Promise.race([Promise.allSettled(...), delay(SHUTDOWN_TIMEOUT_MS)])` between abort and `db.close()`. Named test planned (INC-11, `bootstrap/shutdown.test.ts`) — SPECS §7.5.

None of these map to a new/invented AC ID; each is tagged inline in SPECS/PLAN as "(user-directed correction, 2026-09-27)" and traces to the existing FR it serves. Plan remains **not approved** — still at Phase 5/6, no implementation started.

### 2026-09-27 | unexpected-change | Run metadata and host-version drift (boundary protocol step 4)

Per `docs/EXPERIMENT-BOUNDARY.md` EXP-002 protocol step 4. Values below are evidence-backed rather than inferred from display labels.

| Field | Value | Basis |
|---|---|---|
| Claude Code version | external preflight `2.1.283`; interactive session header `2.1.274`, with an installed update/restart pending | command output plus interactive session header; the mismatch is retained as observed drift rather than normalized away |
| Model | Sonnet 5 (`claude-sonnet-5`) | private native session transcript |
| Reasoning configuration | `medium` | private native session transcript (`effort` field) |
| Permissions / approval mode | not directly queryable this session; `.claude/settings.json` sets only `enabledPlugins`, no explicit permission mode. Observed: interactive approval required for Bash/tool calls this session (multiple prompts; at least one Bash call rejected by the user) | `.claude/settings.json` read + session observation |
| Available tools | `Agent, Artifact, AskUserQuestion, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup, SendFeedback, Skill, ToolSearch, Write` plus deferred (fetched via ToolSearch as needed): `ArtifactComments, ArtifactData, CronCreate, CronDelete, CronList, DesignSync, EndConversation, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, Monitor, NotebookEdit, PushNotification, RemoteTrigger, SendMessage, TaskOutput, TaskStop, WebFetch, WebSearch` | session tool listing |
| Rosetta source commit | `35c65a046259700a63b4ba8281f711d34060563b` | frozen-release record in the independent-evaluation repository, cross-checked against its GOV-004 manifest |
| Full `rosetta-claude` plugin version | `3.1.13` | `.claude-plugin/plugin.json` `"version"` field in the plugin cache dir, matches the cache path segment |
| Plugin artifact | `core-claude-3.1.13-2026-09-15.zip`; SHA-256 `3fc9f6d10d879dfa5036378fbec1801cc69875b7ffea030f27d69eea6f4d7f1b` | frozen-release record in the independent-evaluation repository; the record documents release-API digest comparison and source-tree equivalence |
| Native task transcript SHA-256 | `9b6de9fa5f883179c4afb4e44ef7308c32945fb3b9dbd1ed60cfd1180b151f64` | copied byte-for-byte into permission-restricted, ignored evaluation evidence; raw transcript is not published |

The version mismatch is a study finding: the exact process that executed the planning run identified itself as `2.1.274`, while the separate preflight binary reported `2.1.283`. The session was not restarted mid-run because doing so would have changed the execution environment. Publication must report both values and avoid claiming that one silently substitutes for the other.

### 2026-09-27 | manual-correction | Tracked specs/plan depended on gitignored `agents/TEMP/` content

- What: `plans/chat-poc/chat-poc-SPECS.md` §2 and `plans/chat-poc/chat-poc-PLAN.md` (Governing rule 1, INC-04, "Read first" table) treated `agents/TEMP/chat-poc/architecture-notes.md` — the design-phase working notes — as the sole, non-repeated source for the approved module layout and the 6 key mechanisms (event IDs, terminal-once, persist-then-emit, `STREAM-INV-1`, atomicity, ordering-without-wall-clock).
- Why this matters: `agents/TEMP/` is gitignored (`docs/ARCHITECTURE.md` "Ignored by git"). A tracked deliverable depending on it for load-bearing, non-duplicated content would not survive a fresh checkout — directly at odds with `docs/CONTEXT.md`'s GOV-004 requirement that a fresh session recover from committed artifacts only (AC-015), and with AC-025's requirement that evidence mapping be self-contained.
- Correction: inlined the "Recommended layout" and "Key mechanisms" sections verbatim into `chat-poc-SPECS.md` new §2.1/§2.2 (the committed spec). Updated all four `agents/TEMP` references in `chat-poc-SPECS.md`/`chat-poc-PLAN.md` to cite `chat-poc-SPECS.md §2.1`/`§2.2` instead. `agents/TEMP/chat-poc/architecture-notes.md` now retains only the rejected-option (B, C) rationale and the risk log (R1–R9), which is legitimately session-scoped working material, not a contract.
- Found during: Phase 5 (review_plan) pause, while adding traceability links for the resolved assumptions below, before any reviewer subagent or user sign-off on the plan.
- Resulting state: no tracked file under `plans/` or `docs/` depends on `agents/TEMP/` for content; the one remaining `agents/TEMP` mention (`chat-poc-PLAN.md` line 26, "Phase status stays in `agents/TEMP/chat-poc/coding-flow-state.md`") is a pointer to orchestrator session state, not a contract dependency, and is expected to be ephemeral.

### 2026-09-27 | manual-correction | Traceability links added for design-phase resolved assumptions

- What: `docs/ASSUMPTIONS.md` entries A-002, A-003, A-008, A-010, A-014 were marked `[RESOLVED]` during Phase 3 (user_review_design) but carried no pointer to the test/coverage evidence that will verify them once implemented.
- Correction: added a `Verified by:` line to each, citing the exact `chat-poc-SPECS.md` section and `chat-poc-PLAN.md` increment/named test (or, for A-014, stating no test applies — it is a tooling absence, not runtime behavior).
- Resulting state: every resolved product/technical assumption now traces forward to a spec section and a planned test, closing the loop from decision to verification before implementation starts.

### 2026-09-27 | manual-correction | Unpinned runtime probes were rejected

- What: three proposed Node-based planning probes did not qualify the runtime as the required Node `24.21.0` and were denied at the approval boundary.
- Why: this repository's experiment boundary pins Node `24.21.0`; allowing the host-default runtime would weaken reproducibility even for a planning-time probe.
- Resulting state: the plan now makes the exact Node version a governing rule for every command, install, build, and test. No product implementation resulted from the rejected probes.

### 2026-09-27 | unexpected-change | External scratch-path proposal was rejected

- What: the session proposed using `/private/tmp` for scratch work during planning. The proposal was rejected because it placed evidence outside the experiment repository and its documented evidence boundary; whether the tool had created any transient scratch content before the approval prompt could not be established from the public artifacts.
- Resulting state: no external scratch content is treated as evidence or as an input to the accepted plan. Only tracked repository artifacts and separately hashed private transcripts are authoritative.

### 2026-09-27 | unexpected-change | Reviewer subagent did not complete within the bounded review window

- What: a Rosetta-invoked reviewer subagent remained active without returning an actionable review during the bounded planning window and was interrupted.
- Correction: the user-led review became the accepted review path; its five concrete findings and corrections are recorded above and in the specs/plan.
- Resulting state: no claim is made that the subagent completed or independently approved the plan. This qualitative observation must not be converted into time, token, cost, or productivity claims.

### 2026-09-27 | manual-correction | Unsafe or state-mutating verification proposals were removed

- What: planning produced a `git clean -xdf` close-out command and a rejected index-manipulation proposal using `git add -N` followed by `git reset` solely to inspect untracked content.
- Why: the clean command could delete user or evidence files, while index mutation is unnecessary for review and can disturb the accepted checkpoint.
- Resulting state: final clean-checkout verification now runs in a separate disposable fresh clone/worktree, and review uses read-only diffs or explicitly stages only the files intended for the checkpoint commit.

### 2026-09-28 | unexpected-change | First INC-02 implementation attempt was interrupted by host sleep

The first resumed Claude Code run delegated INC-02 to the Rosetta engineer workflow, but the computer slept while it was running. On resume, the workflow watchdog reported no progress for its 600-second window and stopped the agent. Inspection confirmed that this attempt wrote no target-repository files. The implementation was restarted in a fresh Claude Code session. This is classified as a host/session interruption, not a Rosetta implementation failure, and no productivity inference is made from the watchdog duration.

### 2026-09-28 | unexpected-change | Overlapping interactive prompts temporarily changed approval state and installed a host-side language server

While restoring manual approval mode in the fresh session, overlapping Claude Code prompts caused input intended for one prompt to be consumed by another. The session briefly entered accept-edits/automatic and plan states, and a suggested `typescript-lsp` host-side tool was accepted. Manual approval mode was restored before the remaining scoped implementation. Repository inspection found no unrequested target-repository change from this prompt race; the language-server installation is a host-side change only. This observation is retained because approval UX is relevant to the independent workflow evaluation.

### 2026-09-28 | manual-correction | INC-02 review closed two specification/configuration gaps

Claude Code implemented API configuration, domain types/errors, pure decision modules and ports, then stopped before staging or committing. Independent review found two issues and corrected both before publication: (1) API Node ambient types were initially enabled by a file-local triple-slash directive because TypeScript 7 did not resolve `node:process`; the durable fix is now `"types": ["node"]` in `apps/api/tsconfig.json`, with the local directive removed; (2) `checkAppend` enforced first-event and terminal rules but allowed a second `response.started`, contradicting SPECS §6.2's exactly-one-start invariant. SPECS §3.2 and the implementation now return `already-started` for that case. The stale §2.1 `canRetry` label was also aligned to the implemented §3.4 `classifyRetry` contract.

Validation under pinned Node 24.21.0 passed: full `npm run check`; all 16 response-status transition pairs; first/duplicate-start, delta-status and terminal append guards; idempotency, retry and active-response decisions; domain import-boundary grep; and `git diff --check`. The implementation was committed as `71ee630324f9b6b0db430f52e29bbecaca5940db`, pushed to `origin/experiment/EXP-002`, and the remote ref was independently verified to match.

The repository record types required by SPECS §5.3 were not fully spelled out by field. The implementation chose column-derived `NewConversation`, `NewMessage`, `NewResponse`, `ResponseRecord`, `StreamEventData` and `PersistedEvent` shapes and documents the derivation next to each type. These choices remain subject to concrete adapter validation in INC-03 rather than being claimed as final evidence now.

### 2026-09-28 | unexpected-change | INC-03 session recovered from a transient connection loss without repository loss

The scoped Claude Code INC-03 run lost its connection once while responding. The same native session was resumed, manual approval mode remained in effect, and repository inspection showed the eight persistence files intact. No claim is made about the interruption's cause or duration, and it is not treated as a Rosetta failure or productivity measurement.

### 2026-09-28 | manual-correction | Shell/Python rewrite proposal rejected; repository-local throwaway validation retained

During INC-03, Claude Code proposed a Python heredoc to rewrite `conversation-repo.ts`. It was rejected at the approval boundary because the accepted execution protocol requires normal Edit/Write operations for source changes. Claude then made the change with its Edit tool. A throwaway exit-check script and check log were kept under gitignored `agents/TEMP/` inside the target repository, run under pinned Node 24.21.0, and removed after use; no external scratch path was accepted as experiment evidence. The exit script reported all 32 persistence checks passing, and the full `npm run check` exited 0.

### 2026-09-28 | manual-correction | INC-03 resolved a dependency-rule contradiction and passed independent validation

SPECS §2.2 said `persistence/*` could depend on `ports.ts` types only, while §5.3–§5.4 simultaneously required `EventRepo.append` to call the pure response guard and every read row to use shared/Zod schemas plus `PersistedRecordInvalidError`. The implementation necessarily exposed that contradiction. The rule was corrected narrowly: persistence may import the port interfaces, pure domain guards/errors/types, and shared/Zod validation schemas, but no transport or other outward IO layer. The provider boundary remains ports-types-only.

Independent review inspected every new persistence file, confirmed the exact four tables and seven indexes, verified no executable `await`/`async`/promise scheduling inside persistence and no `lastInsertRowid` use, and re-ran `npm run typecheck`, full `npm run check`, and `git diff --check` under Node 24.21.0. A separate orchestrator-authored temporary smoke outside the repository verified schema idempotence and counts, Promise-return rollback, deterministic conversation/message/event ordering, idempotency rejection with zero extra rows, guarded event sequencing and terminal uniqueness, and close/reopen persistence. It passed and was not committed. INC-03 was committed as `ec2a2448348f6d330926c5d5dff18fea02aa3a73`, pushed, and the remote ref was independently verified to match.

### 2026-09-28 | unexpected-change | INC-04's first long instruction paste was clipped

The resumed Claude Code terminal accepted only the tail of the first detailed INC-04 instruction paste. No implementation was accepted on that ambiguous basis. A shorter corrective prompt explicitly restated the exact seven-file boundary, pinned Node version, manual approval mode, required checks, and stop-before-commit rule; Claude confirmed that scope before writing files. This is retained as an interaction finding, not attributed to Rosetta and not converted into a productivity claim.

### 2026-09-28 | manual-correction | INC-04 review closed a failed-attachment subscriber leak

Claude Code implemented the deterministic provider, provider doubles, response runner, live hub, replay/live subscriber and restart recovery within the accepted INC-04 boundary. Its 22-case throwaway exit check and full `npm run check` passed under Node 24.21.0, and the temporary repository-local check files were removed.

Independent review then inspected all seven source files and re-ran the full check. A separate orchestrator-authored probe passed deterministic chunks, success completion, fixed/redacted provider failure, abort-to-`PROVIDER_INTERRUPTED`, persist-before-publish, zero-event recovery, partial-stream recovery, recovery idempotence, and replay/live deduplication. Review found one additional robustness defect: after installing the buffering subscription, a synchronous `listAfter` or sink-write exception could leave that subscriber registered. `attachResponseStream` now unsubscribes before rethrowing; a focused regression probe confirmed that publishing afterward reaches no leaked sink. SPECS §6.4 and INC-12's named-test list were updated so the correction remains part of the durable contract.

The implementation checkpoint was committed as `2b8e3b4fffd5b28358889f0fe6da36c56d663f8b`, pushed to `origin/experiment/EXP-002`, and the remote ref was independently verified before this evidence follow-up. Two bounded implementation frictions remain documented without widening INC-04: `MessageRepo` has no `findById`, so completion re-reads the conversation to obtain the inserted assistant row; the provider port has no abort signal, so the runner races pending `next()` calls against abort and requests iterator return without awaiting it. Both are acceptable under the current deterministic/local provider boundary and will be re-evaluated during INC-07 shutdown wiring and INC-11 tests.

### 2026-09-28 | unexpected-change | INC-05 instruction paste was clipped a second time

The resumed native Claude Code session again received only the tail of a long scoped instruction paste. Claude recognized the clipping, recovered the task from the committed plan/spec, and stated the correct INC-05 boundary before writing. No work was accepted solely from the clipped prompt. This recurrence strengthens the workflow finding from INC-04: long interactive instruction pastes are not a dependable task-transfer channel; committed artifacts plus a short increment identifier are the safer recovery path. This is an interaction observation, not attributed to Rosetta and not converted into a productivity claim.

### 2026-09-28 | manual-correction | INC-05 review extended the active-response gate to retry creation

Claude Code implemented the five scoped use cases and stopped before staging or committing. Its 15-case repository-local exit smoke covered create/list/get payloads, normalization and limits, send idempotency/conflict/active gating, atomic injected failures, retry eligibility and replay, and post-commit provider-run start; static checks and the full pinned-Node gate passed, and throwaway files were removed.

The exit probe also exposed a contract gap: retrying one failed response while a different response in the same conversation was active reached the database's `ux_responses_one_active_per_conversation` backstop and surfaced a raw SQLite uniqueness error. The one-active-response invariant applies to every newly created response, not only sends. The use case now applies `checkActiveResponseGate` only after `classifyRetry` returns `start`; `existing` replay still returns before the gate. SPECS §3.4a/§4.3/§4.5/§4.6 and the INC-05/INC-11 plan text were corrected so the API returns `409 RESPONSE_ALREADY_ACTIVE` with zero writes instead of an internal error.

Independent review inspected all five source files, re-ran full `npm run check` under Node 24.21.0, and ran an 18-assertion real-SQLite smoke covering create/list/get, normalized send, full-object duplicate replay, conflict, new-send active gate, new-retry active gate, retry replay, row counts, post-commit run start, and read-model retry linkage. All passed. `MessageRepo` still lacks `findById`, so duplicate and retry paths re-read conversation history; this is recorded friction rather than widened scope. The implementation checkpoint was committed as `679f52247792a572087301fff063caaaeef404a5`, pushed, and the remote ref was independently verified to match.

### 2026-09-28 | manual-correction | INC-06 supplied the missing fixed validation-message map and exposed an INC-07 startup-log requirement

Claude Code implemented the HTTP/SSE transport and stopped before committing. The guided live-server run passed the endpoint status matrix, all five `Last-Event-ID` cases, exact SSE replay, malformed-body redaction, configured/foreign-origin CORS, active-response/retry paths, client-disconnect detach followed by terminal replay, draining behavior, and the structured log allowlist. Three corrections during that run belonged only to the temporary harness — quoting a zsh bracket glob, replacing GNU-only `cat -A` on macOS, and attaching the disconnect observer before abort — and did not require product changes.

The transport needed the fixed Zod `issue.code` to public-message map already required by SPECS §4.6, but INC-01 had not created it. It was added to `packages/shared/src/contracts/errors.ts` during INC-06 and consumed by `http/error-envelope.ts`; received values are not echoed. This is recorded as a missed earlier contract item, not an invented transport behavior.

Independent review inspected all ten changed files, re-ran the full `npm run check` under Node 24.21.0, and passed a separate 27-group probe over health/draining, strict/invalid JSON, strict unknown fields, invalid identifiers, unknown routes, configured/foreign-origin CORS, malformed/out-of-range event IDs, unknown-error redaction, log-field filtering, and exact SSE formatting. Implementation checkpoint `3d84946fc3e2ec58b2add574667245d6c1441097` was pushed and the remote ref matched exactly.

Review also found a forward wiring risk: Fastify's framework-generated successful-listen message includes the bound URL in the free-text message. The structured-field formatter cannot remove text already embedded in `msg`, so INC-07 must suppress that message and emit only the explicit allowlisted recovery record. SPECS §7.4 and the INC-07 exit/trap text now make that requirement durable. The existing `DATABASE_UNAVAILABLE` mapping remains compatible with the contract: `/health` intentionally catches database-check failure and returns its non-enveloped health schema per §4.3; no claim is made that a health failure returns an error envelope.

## Deferred items carried from `docs/TODO.md`

- (none currently — the Rosetta source commit and exact released plugin artifact hash were resolved from the frozen-release evidence before Phase 7.)
