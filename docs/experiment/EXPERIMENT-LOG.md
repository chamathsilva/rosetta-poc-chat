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

## Deferred items carried from `docs/TODO.md`

- (none currently — the Rosetta source commit and exact released plugin artifact hash were resolved from the frozen-release evidence before Phase 7.)
