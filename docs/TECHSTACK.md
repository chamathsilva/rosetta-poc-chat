# TECHSTACK

Purpose: installed and intended tech stack. Content: runtime, frameworks, tools by role. Style: terse bullets, current state only.

## Runtime
- Node.js 24.21.0 (npm 11.6.2)
- TypeScript 7.0.2 (strict mode)

## Languages
- TypeScript
- React (19.3.0) JSX/TSX

## Frameworks & Libraries
- **API**: Fastify 5.12.4, @fastify/cors 11.3.0
- **Web**: React 19.3.0, React DOM 19.3.0, Vite 8.3.0
- **Validation**: Zod 4.6.5
- **Database**: SQLite via Node's built-in `node:sqlite` (`DatabaseSync`, WAL); no npm SQLite package (A-011)
- **Streaming**: Server-Sent Events over HTTP; browser client reads them with `fetch` streaming (no `EventSource`, no polyfill)

## Build & Dev Tools
- Vite 8.3.0 (web bundler)
- @vitejs/plugin-react 6.1.1
- TypeScript compiler (tsc)
- Vitest 5.0.0 (test runner)

## Testing
- Vitest 5.0.0 — two projects: `node` (api, shared) and `web` (jsdom) (A-013)
- @testing-library/react 16.3.3
- @testing-library/user-event 14.6.7
- jsdom 30.0.1
- No `@testing-library/jest-dom`, no lint/format tool, no browser E2E runner

## Package Management
- npm workspaces (root configuration)
- Workspace packages: @rosetta-poc/chat-api, @rosetta-poc/chat-web, @rosetta-poc/chat-shared

## Architecture
- Monorepo (3 packages: apps/api, apps/web, packages/shared)
- TypeScript project references (tsconfig.json); api and web reference shared, built with `tsc -b` (A-012)
- Composite builds enabled per package
- ESM modules throughout

## Quality
- Strict TypeScript: noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters
- Vitest with clearMocks: true
