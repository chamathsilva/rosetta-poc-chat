# CODEMAP

Purpose: workspace file map for code navigation. Content: dirs with recursive tracked-file counts, immediate child file names.
Regenerated in INC-14 (2026-10-12) from `git ls-files` at published commit `cab37e1`, written by hand with the editor (the earlier generator script lives in git-ignored `agents/TEMP/` and was not used). Counts are tracked files only; ignored build/test output (`dist/`, `node_modules/`, `data/`) is excluded. The pre-INC-14 version still listed the seed (40 files, placeholder sources).

# rosetta-poc-chat-exp-002 (148 tracked files)

- .editorconfig, .gitignore, .nvmrc, README.md, gain.json
- package.json, package-lock.json, tsconfig.base.json, tsconfig.json, tsconfig.test.json, vitest.config.ts

## .claude (1)

- settings.json

## agents (3)

- IMPLEMENTATION.md, MEMORY.md, init-workspace-flow-state.md

## plans/chat-poc (2)

- chat-poc-PLAN.md, chat-poc-SPECS.md

## docs (17)

- ACCEPTANCE-CRITERIA.md, ARCHITECTURE.md, ASSUMPTIONS.md, CODEMAP.md, CONTEXT.md, DEPENDENCIES.md, EXPERIMENT-BOUNDARY.md, REQUIREMENTS.md, TECHSTACK.md, TODO.md
- experiment/ (2): EVIDENCE-MAP.md, EXPERIMENT-LOG.md
- PATTERNS/ (5): CHANGES.md, INDEX.md, composite-package-tsconfig.md, workspace-package-manifest.md, workspace-script-fanout.md

## packages/shared (19) — `@rosetta-poc/chat-shared`

- package.json, tsconfig.json
- src/ (17): index.ts, ids.ts
  - contracts/: conversation.ts, message.ts, response.ts, events.ts, errors.ts, params.ts, health.ts; tests contracts.test.ts, params.test.ts
  - domain-rules/: normalize.ts, title.ts, terminal.ts; tests normalize.test.ts, title.test.ts, terminal.test.ts

## apps/api (70) — `@rosetta-poc/chat-api`

- package.json, tsconfig.json
- src/ (68): index.ts (entrypoint), ports.ts
  - config/: env.ts
  - domain/: types.ts, errors.ts, idempotency.ts, response-machine.ts, retry.ts; tests errors, idempotency, response-machine, retry
  - persistence/: db.ts, schema.ts, unit-of-work.ts, row-contracts.ts, conversation-repo.ts, message-repo.ts, response-repo.ts, event-repo.ts; tests schema, unit-of-work, ordering, repos
  - provider/: types.ts, deterministic-provider.ts; test deterministic-provider
  - stream/: hub.ts, runner.ts, subscribe.ts, recovery.ts; tests hub, runner, subscribe, recovery
  - usecases/: create-conversation.ts, list-conversations.ts, get-conversation.ts, send-message.ts, retry-response.ts; tests get-conversation, send-message, retry-response
  - http/: server.ts, error-envelope.ts, logging.ts, sse.ts; tests error-envelope, logging, sse
    - routes/: health.ts, conversations.ts, messages.ts, responses.ts, response-events.ts; tests health, conversations, messages, responses, response-events, cors
  - bootstrap/: container.ts, shutdown.ts; test shutdown (includes real child-process cases)
  - testing/ (test helpers, not tests): fake-clock.ts, sequential-ids.ts, temp-db.ts, provider-doubles.ts

## apps/web (25) — `@rosetta-poc/chat-web`

- package.json, tsconfig.json, index.html, vite.config.ts
- test/ (1): setup.ts (jsdom setup)
- src/ (20): main.tsx
  - config/: env.ts
  - api/: http-client.ts, sse-client.ts; test sse-client
  - state/: chat-reducer.ts, ChatProvider.tsx, ui-status.ts; tests chat-reducer, ChatProvider
  - hooks/: useResponseStream.ts, useSelectedConversation.ts; test useResponseStream
  - components/: App.tsx, ConversationList.tsx, MessageList.tsx, MessageComposer.tsx, RetryButton.tsx, StatusAnnouncer.tsx; test App
