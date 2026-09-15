# Rosetta POC: Streaming Chat

A disposable public TypeScript project for an independent, evidence-backed evaluation of Rosetta.

## Baseline status

This repository is intentionally a non-functional seed. It fixes the requirements, acceptance criteria, architecture boundary, and test-ready workspace, but contains no chat, API, streaming, persistence, or recovery implementation.

The immutable starting point for `EXP-002` and `GOV-004` is the Git tag `chat-seed-v1`. Rosetta must not be invoked before that seed is created.

## Intended product

The experiment will build a small full-stack chat application with:

- a React web client;
- a Fastify API;
- shared TypeScript contracts;
- deterministic mock responses requiring no external AI credentials;
- Server-Sent Events streaming;
- SQLite conversation and event persistence;
- refresh, reconnect, retry, and interrupted-session recovery.

Read:

- [Requirements](docs/REQUIREMENTS.md)
- [Acceptance criteria](docs/ACCEPTANCE-CRITERIA.md)
- [Experiment boundary](docs/EXPERIMENT-BOUNDARY.md)

## Workspace

```text
apps/
├── api/       Fastify API placeholder
└── web/       React/Vite placeholder
packages/
└── shared/    Shared-contract placeholder
```

## Seed verification

```bash
nvm use
npm ci
npm run check
```

At the seed commit, these checks verify only the workspace and toolchain. Passing them does not indicate that any product requirement has been implemented.

## Experiment rule

All product design, implementation, product tests, review, and validation belong to `EXP-002` and must be performed in a fresh Claude Code session using the recorded full `rosetta-claude` plugin configuration. `GOV-004` must use its own fresh branch and session from the same seed.
