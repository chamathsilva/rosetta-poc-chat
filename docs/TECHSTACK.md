# TECHSTACK

## Runtime & Package Management

- **Node.js**: >=24 (specified in package.json engines)
- **npm**: 11.6.2 (packageManager field)
- **Workspaces**: npm workspaces (root package.json)

## Languages

- **TypeScript**: 7.0.2 (strict mode, ES2024 target)

## Frameworks & Libraries

### Frontend (apps/web)
- **React**: 19.3.0
- **React DOM**: 19.3.0
- **Vite**: 8.3.0 (bundler)
- **@vitejs/plugin-react**: 6.1.1

### Backend (apps/api)
- **Fastify**: 5.12.4
- **@fastify/cors**: 11.3.0

### Shared (packages/shared)
- **Zod**: 4.6.5 (schema validation)

## Testing & Development

- **Vitest**: 5.0.0 (test runner)
- **@testing-library/react**: 16.3.3
- **@testing-library/user-event**: 14.6.7
- **jsdom**: 30.0.1 (DOM for testing)

## Code Quality

- **TypeScript** (strict: true, noUnusedLocals, noUnusedParameters)
- **EditorConfig**: .editorconfig (project root)

## Build & Configuration Files

- **tsconfig.base.json**: Base TypeScript config (strict mode settings)
- **tsconfig.json**: Root-level TypeScript config
- **vitest.config.ts**: Vitest config (includes apps/**/*.test.* and packages/**/*.test.*)
- **vite.config.ts**: Vite config (apps/web)

## Monorepo Structure

Workspaces:
- `apps/*` (web, api)
- `packages/*` (shared)
