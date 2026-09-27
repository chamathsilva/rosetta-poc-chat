# Workspace Package Manifest

## Name
Workspace Package Manifest

## Description
Every npm workspace package declares a private, ESM, scoped manifest named `@rosetta-poc/chat-<name>`, pinned to exact versions, with `build` and `typecheck` scripts. Use when adding a new app or package under `apps/*` or `packages/*`. Internal dependencies use the exact workspace version `0.0.0`. Shared libraries add `exports` and `types` pointing into `dist/`.

## Template
```json
{
  "name": "@rosetta-poc/chat-<name>",   // EXTENSION: <name> = api | web | shared | new
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./dist/index.js",         // EXTENSION: libraries only (shared)
  "types": "./dist/index.d.ts",         // EXTENSION: libraries only (shared)
  "scripts": {
    "build": "tsc -p tsconfig.json",    // EXTENSION: web uses "tsc -p tsconfig.json --noEmit && vite build"
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@rosetta-poc/chat-shared": "0.0.0", // EXTENSION: internal deps at 0.0.0
    "zod": "4.6.5"                       // EXTENSION: exact (unprefixed) versions
  }
}
```

## Sources
- apps/api/package.json
- apps/web/package.json
- packages/shared/package.json
