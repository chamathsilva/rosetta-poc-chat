# Rosetta POC: Streaming Chat

A disposable public TypeScript project for an independent, evidence-backed evaluation of Rosetta.

## Status

On branch `experiment/EXP-002`, the planned product is implemented and tested: increments INC-00 to INC-13 are published, latest `cab37e1`. INC-14 (evidence, docs and close-out) is awaiting independent final review.

**This is not a claim that EXP-002 is complete or accepted.** Acceptance is decided by the independent evaluation, recorded separately. Per-criterion status, evidence locations and known limits are in [`docs/experiment/EVIDENCE-MAP.md`](docs/experiment/EVIDENCE-MAP.md). Every correction, deviation and interruption is in [`docs/experiment/EXPERIMENT-LOG.md`](docs/experiment/EXPERIMENT-LOG.md).

The `main` branch and the immutable `chat-seed-v1` tag remain the non-functional experiment seed.

## What it is

A small full-stack chat application:

- a React 19 web client (Vite) with keyboard-accessible conversation list, composer, status announcements and Retry;
- a Fastify 5 API with JSON error envelopes and exact-origin CORS;
- shared Zod contracts used by both sides;
- a deterministic mock assistant: no AI provider, network access or credentials;
- Server-Sent Events streaming with `Last-Event-ID` replay;
- SQLite persistence through Node's built-in `node:sqlite`;
- refresh/reconnect resume, one retry per failed response, idempotent sends, and recovery of interrupted responses on restart.

## Requirements

- Node.js **24.21.0** (see `.nvmrc`) with npm 11.6.2.

## Verify

```bash
nvm use
npm ci
npm run check   # typecheck (product + tests), 437 Vitest tests, production build
```

## Run locally

Use two terminals from the repository root:

```bash
npm run dev:api   # builds shared + API, starts http://127.0.0.1:8787
npm run dev:web   # builds shared, starts Vite at http://localhost:5173
```

Open `http://localhost:5173`. Stop the API with Ctrl+C; it drains and shuts down gracefully.

The defaults need no configuration. To override them, set environment variables:

| Variable | Default | Used by |
|---|---|---|
| `CHAT_DB_PATH` | `./data/chat.sqlite` (relative to `apps/api`; directory created on start; git-ignored) | API |
| `CHAT_API_PORT` | `8787` | API |
| `CHAT_API_HOST` | `127.0.0.1` | API |
| `CHAT_WEB_ORIGIN` | `http://localhost:5173` (the only origin CORS allows) | API |
| `CHAT_LOG_LEVEL` | `info` | API |
| `VITE_API_BASE_URL` | `http://localhost:8787` | web |

Invalid API configuration stops the process at startup (exit code 1) and prints each invalid variable's name with its validation message; the received values are never printed. If you change the web port or host, set `CHAT_WEB_ORIGIN` to match, or the browser's requests will be refused by CORS.

## Workspace

```text
apps/
├── api/       Fastify API: config, domain, SQLite persistence, provider, streaming, HTTP/SSE, bootstrap
└── web/       React client: HTTP/SSE clients, reducer and provider, hooks, components
packages/
└── shared/    Shared Zod contracts and domain rules
```

## Known limits

- UI tests run in jsdom. Real-browser behaviour was checked manually, not by an automated browser test.
- Restart recovery is tested with seeded interruptions, not power loss.
- There is no lint or format tool.

Full list: the "Recorded limits" section of the evidence map.

## Read more

- [Requirements](docs/REQUIREMENTS.md) and [acceptance criteria](docs/ACCEPTANCE-CRITERIA.md)
- [Architecture](docs/ARCHITECTURE.md) and [code map](docs/CODEMAP.md)
- [Specification](plans/chat-poc/chat-poc-SPECS.md) and [plan](plans/chat-poc/chat-poc-PLAN.md)
- [Experiment boundary](docs/EXPERIMENT-BOUNDARY.md)

## Experiment rule

All product design, implementation, product tests, review, and validation belong to `EXP-002` and must be performed in a fresh Claude Code session using the recorded full `rosetta-claude` plugin configuration. `GOV-004` must use its own fresh branch and session from the same seed.
