# Experiment Boundary

## Seed contents

The `chat-seed-v1` baseline contains only:

- fixed product requirements, acceptance criteria, and architecture boundary;
- repository metadata and ignore rules;
- pinned npm workspace, TypeScript, React/Vite, Fastify, Zod, and test tooling;
- empty API and shared-package modules;
- a web placeholder stating that implementation begins during `EXP-002`.

It contains no chat interface, API routes, shared runtime contracts, provider, SQLite schema, persistence, SSE handling, reconnection, retry, recovery, product tests, Rosetta workspace files, or generated Rosetta artifacts.

## EXP-002 protocol

1. Start from the immutable seed commit in a clean working tree.
2. Create a dedicated experiment branch or clean repository copy.
3. Start a fresh Claude Code session.
4. Record Claude Code version, model, reasoning configuration, permissions, available tools, Rosetta source commit, full `rosetta-claude` plugin version, and plugin artifact hash.
5. Install or activate only the recorded full `rosetta-claude` plugin for the experiment.
6. Give Claude Code the recorded original prompt.
7. Preserve questions, plans, specifications, approvals, implementation trajectory, review findings, tests, corrections, and final acceptance evidence.

## GOV-004 protocol

Run the interrupted-session recovery experiment from a separate fresh branch or copy of `chat-seed-v1`. Do not reuse the `EXP-002` transcript, memory, plan, specification, or implementation. Intentionally stop after committed project artifacts are sufficient to resume, then begin a new Claude Code session and record what it can recover without conversational context.

## Contamination rules

- Do not invoke Rosetta while creating the seed.
- Do not copy plans, specifications, implementation, or transcripts between `EXP-002` and `GOV-004`.
- Do not add hidden acceptance criteria after a run starts.
- Do not use client data, private code, production credentials, or a real LLM provider.
- Do not publish time, token, cost, or productivity-multiplier claims.
