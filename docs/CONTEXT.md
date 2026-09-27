# CONTEXT

Purpose: business/behavioral context of this workspace for every AI session. Stakeholder view: why it exists, who uses it, what it must do, what is out of bounds.
Style: terse bullets, no technology or code detail (see `docs/ARCHITECTURE.md`). Target behavior is summarized, not restated: full contract = `docs/REQUIREMENTS.md` (FR-*), `docs/ACCEPTANCE-CRITERIA.md` (AC-*), `docs/EXPERIMENT-BOUNDARY.md`. Those three are fixed, read-only inputs: never edit or weaken them.

## Status (read first)

- Repo HEAD = seed tag `chat-seed-v1`: deliberately NON-FUNCTIONAL. No chat, API, contracts, provider, storage, streaming, retry, or recovery exists yet.
- Everything under "Target Product" is TARGET state to be built in `EXP-002`. Do not describe it as implemented until code + tests prove it.
- Progress is tracked only in `agents/IMPLEMENTATION.md`.

## Purpose

- Disposable public proof-of-concept used for an independent, evidence-backed evaluation of Rosetta-assisted development.
- Product is a vehicle: a small chat app chosen because it makes cross-layer contracts, streamed state, persistence, and recovery observable and testable.
- Must run locally and reproducibly: no external AI service, no credentials, no network dependence.

## Experiments

- `EXP-002` (this branch `experiment/EXP-002`): Rosetta-assisted build of the full chat POC from the seed. Done only when every AC is passed with evidence location or explicitly failed with explanation.
- `GOV-004`: separate run from the same seed on its own branch/session; tests whether a fresh session can resume work from committed artifacts only (AC-015). Evidence recorded separately.
- Seed: immutable starting commit, tag `chat-seed-v1`.

## Experiment Rules (contamination)

- Never copy plans, specs, code, memory, or transcripts between `EXP-002` and `GOV-004`. A tag `gov-004-accepted-run-v1` exists in this clone: do not read, diff, or check it out during `EXP-002`.
- Rosetta init files (docs/, agents/, gain.json) are EXP-002 artifacts, committed as evidence; never copy to GOV-004.
- No client data, private code, production credentials, or real LLM provider.
- No hidden acceptance criteria after a run starts; criteria must not be weakened. Any change = recorded study deviation.
- Changing a fixed technology requires a recorded study deviation before implementation.
- Record every missed requirement, manual correction, unexpected change, or deferral in the experiment log (AC-026) in `docs/experiment/EXPERIMENT-LOG.md`; AC-025 evidence map in `docs/experiment/EVIDENCE-MAP.md` (both committed, created during the run).
- Publish no time, token, cost, or productivity claims.
- Preserve questions, plans, specs, approvals, review findings, tests, corrections, acceptance evidence.

## Actors

- Local user: single person, no sign-in, uses the web chat.
- Experiment operator: runs `EXP-002`/`GOV-004`, records configuration and evidence.
- Evaluator/reviewer: checks every FR/AC maps to implementation + test evidence (AC-025).

## Target Product (not yet built)

- Conversations: list (most recently updated first), create, select; selection survives page refresh. Summary = id, title, updatedAt; title derived from the first user message (truncated), placeholder until one exists (A-010).
- Messages: user sends non-empty text (trimmed, max 4000 Unicode code points); assistant reply streams in progressively; ordered history.
- Assistant: deterministic mock; same normalized input -> same reply, always.
- Durability: conversations, messages, replies, stream progress survive page refresh and server restart.
- Resume: after refresh or dropped connection, reply continues from last seen point; no duplicated messages or text.
- Failure: safe failure shown; user message and any partial reply kept; exactly one user-initiated retry.
- Duplicate sends: same send repeated = same result, nothing duplicated; same send key with different text = conflict, nothing stored.
- Accessibility: fully keyboard usable; status changes announced to assistive technology.
- Safety: user/assistant text always shown as plain text; errors never leak internals or full message content.

## Domain Model (target)

- Conversation: has ordered Messages; ordered by last update.
- Message: user or assistant; order must not depend only on timestamps.
- Response: one assistant reply to one user message; produced as an ordered sequence of stream Events.
- Event: started -> zero+ deltas -> exactly one terminal (completed | failed). Event numbers increase per response.
- Retry: at most one per failed Response; yields one replacement Response; repeated retry requests return that same replacement; if the replacement also fails, no further retry is offered (A-003).

## Response Lifecycle (target, implicit state machine)

- pending: user message accepted, reply record created together (all-or-nothing).
- streaming: started, deltas arriving.
- completed: terminal, full reply.
- failed: terminal, safe failure; partial text kept; retry offered once.
- interrupted: non-terminal reply found after server restart; transitioned to `failed` (safe, redacted text) on detection and offered the standard single retry — never left/shown as silently completed (AC-014, A-002).
- UI statuses the user must see distinctly: sending, streaming, completed, failed, reconnecting, retrying; plus distinguishable network, server, validation, and provider errors each with a next action (AC-018).

## Non-Goals

- Auth, multiple users/tenants, production deployment, scaling.
- Real LLM, model quality, benchmarking.
- Attachments, images, voice, markdown rendering, tools.
- Editing, branching, sharing, search, export of conversations.
- Multiple or automatic retries. WebSockets.
- Telemetry or external runtime services.

## Glossary

- Seed: `chat-seed-v1`, immutable non-functional baseline.
- FR-nnn / AC-nnn: requirement / acceptance-criterion IDs in the fixed docs.
- Study deviation: recorded, justified departure from fixed requirements/technology.
- Normalized message: trimmed content only (case and inner whitespace preserved); input form the mock uses for determinism (A-008).
- Client message ID: sender-chosen idempotency key, unique within a conversation.
- Terminal event: completed or failed; exactly one per response.
- Replacement response: the single response created by a retry.
