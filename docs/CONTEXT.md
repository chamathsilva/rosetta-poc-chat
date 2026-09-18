# CONTEXT

Business and domain context for this workspace: what it is for, who cares, and which rules constrain work here.
Stakeholder perspective only — no technical detail. Architecture and stack live in `ARCHITECTURE.md`; file structure in `CODEMAP.md`.
Style: terse bullets, grep-friendly headers. Loaded in every AI session, so keep it under 100 lines.

## What this repository actually is

- **A research artifact, not a product.** "Rosetta POC: Streaming Chat" exists to produce an independent, evidence-backed evaluation of the Rosetta AI-workflow plugin itself.
- **Disposable and public.** It is not client work, has no users, no production deployment, and no roadmap beyond the experiments below.
- **The subject under test is Rosetta, not the chat app.** The chat app is the fixed task used to observe how Rosetta behaves.
- **The code at this commit is an intentionally non-functional seed** (`chat-seed-v1`, immutable git tag). It fixes requirements, acceptance criteria, the technology boundary, and a placeholder workspace — nothing more.
- The seed deliberately contains **zero** chat interface, API routes, runtime contracts, provider, persistence, streaming, reconnection, retry, or recovery behavior, and no product tests.

## Authoritative seed documents

These pre-exist Rosetta, were written by the study author, and **override anything Rosetta generates**. Rosetta docs describe; these govern.

- `docs/REQUIREMENTS.md` — the product contract: FR-001..FR-011, fixed technology boundary, quality requirements, non-goals.
- `docs/ACCEPTANCE-CRITERIA.md` — AC-001..AC-026, fixed before any run; pass requires automated evidence.
- `docs/EXPERIMENT-BOUNDARY.md` — seed contents, run protocols, contamination rules.
- Never edit these to fit an implementation. A needed change is a **recorded study deviation**, decided by the human.

## The two experiments run from this seed

- **EXP-002** — full product implementation from the seed, in its own fresh session and branch.
- **GOV-004** — *this branch*: interrupted-session recovery. Work stops deliberately once committed artifacts are sufficient to resume; a **new session with no conversational context** then records what it can recover from the repository alone.
- Consequence for GOV-004: **committed artifacts are the experiment's output.** Anything understood but left only in chat is lost data. Write decisions down.

## Contamination rules (hard constraints on any session here)

- Do not copy plans, specifications, implementation, or transcripts between EXP-002 and GOV-004.
- Do not add or weaken acceptance criteria after a run has started; no hidden criteria.
- Do not use client data, private code, production credentials, or a real LLM provider.
- Do not publish time, token, cost, or productivity-multiplier claims.
- Rosetta was not invoked while the seed was created; the seed commit stays untouched.
- Running Rosetta on `experiment/GOV-004` after the `chat-seed-v1` tag is compliant and is the experiment itself — the prohibition targets seed *creation*, not post-tag experiment branches. Confirmed by the human, 2026-09-17.

## The product intent that eventually gets built

From `docs/REQUIREMENTS.md` — the business behavior EXP-002/GOV-004 must deliver. Read that file for the binding wording.

### Who it serves

- One local user, on their own machine. No authentication, no accounts, no multi-user, no tenants.

### What the user can do (FR-001)

- See their conversations, most recently updated first; create one; select one.
- Read a conversation's messages in order, user and assistant interleaved.
- Send a non-empty text message.
- Always know where the answer stands: sending, streaming, completed, failed, reconnecting, retrying.
- Do all of it by keyboard, with status changes announced to assistive technology.

### What the product promises about answers

- **Answers arrive progressively** as they are produced, not in one block (FR-004).
- **An interruption does not lose the answer.** Reconnecting resumes where the user left off, with no repeated or missing text (FR-005, FR-007).
- **A page refresh is safe.** The conversation and any in-flight answer come back (FR-007).
- **Nothing is lost on restart.** Conversations and answers survive the service stopping (FR-006).
- **A failure keeps the user's words.** The message and any partial answer remain, the failure is stated plainly, and the user gets exactly **one** retry (FR-008).
- **A double-send is not a double-message.** Resending the same message is recognized as the same message (FR-009).
- **Responses are reproducible.** The same input always yields the same answer, with no network, credentials, or clock dependence — this is what makes the evaluation evidence trustworthy (FR-003).

### Domain vocabulary

- **Conversation** — an ordered thread of messages belonging to the local user.
- **Message** — one user or assistant turn within a conversation.
- **Response** — one attempt to produce an assistant message; reaches exactly one terminal outcome, completed or failed.
- **Stream event** — one ordered, persisted step of a response, replayable to a reconnecting client.
- **Provider** — the source of assistant text; deterministic and local by design, never a real model.
- **Retry** — the single permitted replacement for a failed response.

### Deliberately out of scope

- Auth, multi-user, production deployment; real LLM calls or model-quality judgement; WebSockets.
- Attachments, images, voice, markdown rendering, tools, function calling.
- Conversation editing, branching, sharing, search, export.
- Multiple or automatic retries; horizontal scaling; performance or cost benchmarking.

## Working rules for AI sessions in this repo

- Treat `REQUIREMENTS.md` and `ACCEPTANCE-CRITERIA.md` as the definition of done; nothing else counts as a requirement.
- No invented requirements, no "nice to have" additions, no scope beyond FR-001..FR-011.
- Passing `npm run check` at the seed proves the toolchain only — never report it as product progress.
- Record every assumption in `docs/ASSUMPTIONS.md` and every deferral in `docs/TODO.md`, because the next session may have no memory of this one.
