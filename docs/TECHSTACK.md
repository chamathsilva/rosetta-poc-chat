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
- **Database (intended, not yet installed)**: SQLite

## Build & Dev Tools
- Vite 8.3.0 (web bundler)
- @vitejs/plugin-react 6.1.1
- TypeScript compiler (tsc)
- Vitest 5.0.0 (test runner)

## Testing
- Vitest 5.0.0
- @testing-library/react 16.3.3
- @testing-library/user-event 14.6.7
- jsdom 30.0.1

## Package Management
- npm workspaces (root configuration)
- Workspace packages: @rosetta-poc/chat-api, @rosetta-poc/chat-web, @rosetta-poc/chat-shared

## Architecture
- Monorepo (3 packages: apps/api, apps/web, packages/shared)
- TypeScript project references (tsconfig.json)
- Composite builds enabled per package
- ESM modules throughout

## Quality
- Strict TypeScript: noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters
- Vitest with clearMocks: true
