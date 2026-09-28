# Evidence Map (AC-025)

Purpose: map every `docs/REQUIREMENTS.md` FR and every `docs/ACCEPTANCE-CRITERIA.md` AC to its implementation file(s) and test file(s), so a reviewer needs no argument, only this table. Created as a tracked skeleton before implementation (Phase 4 spec/plan review); filled in incrementally as each `plans/chat-poc/chat-poc-PLAN.md` increment lands (per-ID `Status` and `Implementation path`/`Test path` columns), not batched at the end.
Do not weaken or delete a row to make status look better; a criterion that cannot pass is marked `Failed` with an explanation, per the Completion rule in `docs/ACCEPTANCE-CRITERIA.md`.

Status values: `Not started` | `In progress` | `Passed` | `Failed (explanation)`.

## Functional requirements

| ID | Spec section | Plan increment(s) | Implementation path | Test path | Status |
|---|---|---|---|---|---|
| FR-001 | SPECS §9.1, §9.3, §9.6 | INC-09, INC-13 | TBD | TBD | Not started |
| FR-002 | SPECS §4.3, §4.6 | INC-05, INC-06 | TBD | TBD | Not started |
| FR-003 | SPECS §3.5 | INC-04 | `apps/api/src/provider/{types,deterministic-provider}.ts`, `apps/api/src/testing/provider-doubles.ts` | INC-04 deterministic and runner exit/independent smokes passed; automated INC-10 test pending | In progress |
| FR-004 | SPECS §3.2, §6.1, §6.2 | INC-04, INC-06 | INC-04 done: `apps/api/src/stream/{hub,runner}.ts`; remaining: INC-06 SSE framing/route | Persist-before-publish and terminal-shape smokes passed; automated INC-12 coverage pending | In progress |
| FR-005 | SPECS §6.3, §6.4, §6.5 | INC-04, INC-06, INC-08 | INC-04 done: `apps/api/src/stream/{hub,subscribe}.ts`; remaining: INC-06/08 transport clients | Independent replay/live dedupe, terminal close, cross-response isolation, and failed-attach cleanup probes passed; automated INC-12 coverage pending | In progress |
| FR-006 | SPECS §5.1, §5.2, §5.3, §5.5 | INC-03 | `apps/api/src/persistence/{db,schema,unit-of-work,row-contracts,conversation-repo,message-repo,response-repo,event-repo}.ts` | INC-03 32-case throwaway exit smoke + independent restart/transaction smoke passed; automated INC-11 tests pending | In progress |
| FR-007 | SPECS §9.3, §9.4, §9.5, §6.5 | INC-08, INC-09 | TBD | TBD | Not started |
| FR-008 | SPECS §3.4, §4.5, §5.6 | INC-04, INC-05, INC-09 | INC-04 failure/recovery foundation done: `apps/api/src/stream/{runner,recovery}.ts`, `apps/api/src/testing/provider-doubles.ts`; remaining: INC-05/09 | Safe failure and recovery smokes passed; retry use-case/UI tests pending | In progress |
| FR-009 | SPECS §3.4, §4.4, §5.5 | INC-02, INC-05 | INC-02 done: `apps/api/src/domain/idempotency.ts`, `apps/api/src/ports.ts`; remaining: INC-05 use-case wiring | INC-02 throwaway domain smoke passed; automated INC-10/11 coverage pending | In progress |
| FR-010 | SPECS §3.1, §4.1, §5.4, §7.1, §7.2, §7.3, §9.6 | INC-01, INC-02, INC-03, INC-06, INC-08 | INC-01 done: `packages/shared/src/{ids,domain-rules/normalize}.ts`; INC-02 done: `apps/api/src/config/env.ts`, `apps/api/src/domain/errors.ts`; INC-03 done: `apps/api/src/persistence/row-contracts.ts` plus all repository read paths; remaining: INC-06/08 | INC-03 full `npm run check` and read-back/schema smoke passed under Node 24.21.0; automated tests pending | In progress |
| FR-011 | SPECS §7.4, §7.5 | INC-07 | TBD | TBD | Not started |

## Acceptance criteria

| ID | Spec section | Plan increment(s) | Implementation path | Test path | Status |
|---|---|---|---|---|---|
| AC-001 | SPECS §8.1, §8.2, §8.3 | INC-00 (re-verified at INC-14 exit) | `package.json`, `apps/api/package.json`, `apps/web/package.json`, `packages/shared/package.json`, `apps/api/tsconfig.json`, `apps/web/tsconfig.json`, `packages/shared/tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `apps/web/test/setup.ts` | n/a (`npm ci && npm run check`, zero product tests present) | Passed — verified twice under pinned Node 24.21.0 (engineer subagent run + independent orchestrator re-run), both clean-tree, exit 0. Throwaway jsdom smoke test confirmed the `web` Vitest project runs under jsdom, then was removed. Re-verified again at INC-14 exit once product code exists. |
| AC-002 | SPECS §9.3, §9.6 | INC-09, INC-13 | TBD | TBD | Not started |
| AC-003 | SPECS §3.5, §6.2 | INC-04, INC-10 | `apps/api/src/provider/deterministic-provider.ts`, `apps/api/src/stream/runner.ts` | Deterministic chunk/payload exit smoke passed under one fake clock; automated INC-10 test pending | In progress |
| AC-004 | SPECS §4.1–§4.3, §4.6, §6.2 | INC-01, INC-06, INC-08 | INC-01 done: all 7 `packages/shared/src/contracts/{conversation,message,response,events,errors,params,health}.ts`. Corrected shapes: `sendMessageAcceptedSchema`, `responseCompletedDataSchema` (full objects, not IDs). Execution-discovered additions: `healthResponseSchema` (new 7th module, orchestrator-approved) and, in `conversation.ts`, `createConversationRequestSchema` + the 3 previously-unnamed §4.3 response wrappers `createConversationResponseSchema`/`listConversationsResponseSchema`/`getConversationResponseSchema`, plus `retryAcceptedSchema` in `response.ts` — all found missing across two independent review passes, see `EXPERIMENT-LOG.md`. Remaining: consumption by INC-06 (api routes), INC-08 (web client) | TBD | In progress |
| AC-005 | SPECS §5.1, §5.2 | INC-03, INC-07, INC-11 | INC-03 done: `apps/api/src/persistence/{db,schema}.ts` and all four repositories; remaining: INC-07/11 | Independent file-backed close/reopen smoke preserved all four tables; automated restart test pending | In progress |
| AC-006 | SPECS §5.5 | INC-05, INC-11 | TBD | TBD | Not started |
| AC-007 | SPECS §5.2 | INC-03, INC-11 | INC-03 done: `apps/api/src/persistence/{conversation-repo,message-repo,event-repo}.ts` | Identical-timestamp/global and scoped-sequence ordering passed in exit smokes; automated INC-11 test pending | In progress |
| AC-008 | SPECS §3.4, §4.4, §5.5 | INC-02, INC-05, INC-11 | INC-02 done: `apps/api/src/domain/idempotency.ts`; INC-03 done: `apps/api/src/persistence/{schema,message-repo}.ts` (scoped unique index + lookup); remaining: INC-05/11 | Duplicate-key persistence smoke passed with zero extra rows; automated INC-11 coverage pending | In progress |
| AC-009 | SPECS §3.4, §4.4, §5.5 | INC-02, INC-05, INC-11 | INC-02 done: `apps/api/src/domain/idempotency.ts`; INC-03 done: `apps/api/src/persistence/{schema,message-repo}.ts`; remaining: INC-05/11 | Duplicate-key DB rejection passed; use-case conflict/zero-write test pending INC-11 | In progress |
| AC-010 | SPECS §3.2, §5.2, §6.2 | INC-02, INC-03, INC-04, INC-12 | INC-02/03 prerequisites plus INC-04 `apps/api/src/stream/{runner,recovery}.ts` complete; remaining: automated INC-12 tests | Exit and independent smokes passed contiguous seq, exactly one start/terminal, and nothing published before persistence; automated INC-12 coverage pending | In progress |
| AC-011 | SPECS §6.4 | INC-04, INC-12 | `apps/api/src/stream/{hub,subscribe}.ts` | Independent replay/backfill/live race probe passed strict ordering and dedupe; failed-attachment cleanup probe passed; automated INC-12 tests pending | In progress |
| AC-012 | SPECS §6.3, §4.6 | INC-01, INC-06, INC-12 | INC-01 done: `packages/shared/src/contracts/params.ts` (`parseLastEventId`); remaining: INC-06 route wiring, INC-12 tests | TBD | In progress |
| AC-013 | SPECS §9.4 (rules 1, 3, 6), §6.5 | INC-08, INC-13 | TBD | TBD | Not started |
| AC-014 | SPECS §5.6 | INC-04, INC-07, INC-11 | INC-04 done: `apps/api/src/stream/recovery.ts`; remaining: INC-07 boot wiring and INC-11 automated tests | Zero-event and partial-stream file-backed recovery probes passed, including idempotent second pass; boot-order wiring pending | In progress |
| AC-015 | out-of-product; see Note below | INC-14 | n/a (`EXP-002`) | n/a (`GOV-004` run) | Not started — evidence location is the separate `GOV-004` run |
| AC-016 | SPECS §3.5, §4.2, §5.6 | INC-04, INC-11 | `apps/api/src/stream/runner.ts`, `apps/api/src/provider/types.ts`, `apps/api/src/testing/provider-doubles.ts` | Independent disconnect probe preserved partial text, emitted one fixed safe failure, and excluded provider message; automated INC-11 test pending | In progress |
| AC-017 | SPECS §3.4, §4.5, §5.2 | INC-05, INC-11 | Persistence prerequisite done in INC-03: `apps/api/src/persistence/{schema,response-repo}.ts` (unique replacement index + lookup); remaining: INC-05/11 | DB/index exit checks passed; repeated-retry use-case test pending | In progress |
| AC-018 | SPECS §9.1, §9.2, §9.6 | INC-08, INC-09, INC-13 | TBD | TBD | Not started |
| AC-019 | SPECS §3.1, §4.1, §10 | INC-01, INC-10, INC-11 | INC-01 done: `packages/shared/src/domain-rules/normalize.ts` (`normalizeContent`, `codePointLength`, `checkContent`), `packages/shared/src/ids.ts` (`clientMessageIdSchema`); remaining: INC-10/11 tests | TBD | In progress |
| AC-020 | SPECS §9.6 | INC-09, INC-13 | TBD | TBD | Not started |
| AC-021 | SPECS §4.6, §7.4 | INC-06, INC-07, INC-10 | TBD | TBD | Not started |
| AC-022 | SPECS §9.6 | INC-09, INC-13 | TBD | TBD | Not started |
| AC-023 | SPECS §7.3 | INC-06, INC-11 | TBD | TBD | Not started |
| AC-024 | SPECS §10 | INC-10, INC-11, INC-12, INC-13 | TBD | TBD | Not started — this row itself is the test-layer inventory, not a single file |
| AC-025 | SPECS §13 | INC-14 | this file | n/a (manual review) | In progress — skeleton created; rows filled as INC-00..INC-13 land |
| AC-026 | SPECS §13 | INC-14 | `docs/experiment/EXPERIMENT-LOG.md` | n/a (manual review) | In progress — log created, first entry recorded |

### Note on AC-015

AC-015 cannot be satisfied by product code or a product test: it measures whether a fresh Claude Code session, given only committed `EXP-002` artifacts, can recover the implementation task — that is the separate `GOV-004` run on its own branch, per `docs/CONTEXT.md` Experiment Rules and `docs/EXPERIMENT-BOUNDARY.md` GOV-004 protocol. `EXP-002`'s only obligation is that its own committed artifacts (`docs/**`, `plans/chat-poc/**`, `agents/IMPLEMENTATION.md`) are self-sufficient for such a resume — which is also why every tracked planning file was corrected to carry its own contract content rather than depend on the gitignored `agents/TEMP/` working area (see `docs/experiment/EXPERIMENT-LOG.md`).
