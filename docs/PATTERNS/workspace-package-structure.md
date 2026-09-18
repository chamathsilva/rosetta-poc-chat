# Workspace Package Structure

## Name
Workspace Package Structure

## Description
Every npm workspace member (`apps/api`, `apps/web`, `packages/shared`) is defined by a paired `package.json` + `tsconfig.json` at its root, plus a `src/` directory holding the module's source. The root `tsconfig.json` lists each member as a TypeScript project reference (`composite` build graph), and every member's `tsconfig.json` extends the shared `tsconfig.base.json` instead of repeating compiler options. Each `package.json` is scoped under `@rosetta-poc/chat-*` and exposes the same two npm scripts (`build`, `typecheck`) so the root-level `npm run build --workspaces` / `npm run typecheck --workspaces` commands work uniformly across members.

Use this pattern whenever a new workspace member (app or shared package) is added — do not hand-roll a one-off `tsconfig.json` or introduce a differently-named script.

Found in (2+ occurrences, applies to all 3 current members):
- `apps/api/package.json` + `apps/api/tsconfig.json`
- `apps/web/package.json` + `apps/web/tsconfig.json`
- `packages/shared/package.json` + `packages/shared/tsconfig.json`
- Referenced from root `tsconfig.json` (`references` array) and root `package.json` (`workspaces` array)

## Template/Example

`tsconfig.json` (member root):
```jsonc
{
  "extends": "../../tsconfig.base.json", // EXTENSION POINT: always point at repo-root base config
  "compilerOptions": {
    "composite": true,                   // required so root tsconfig.json can reference this project
    "declaration": true,                 // omit only for non-published UI apps (see apps/web, which also skips this)
    "module": "NodeNext",                // EXTENSION POINT: "ESNext" + "Bundler" resolution for browser/Vite apps
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist"                     // EXTENSION POINT: "dist/types" style for build-tool-driven apps
  },
  "include": [
    "src/**/*.ts"                        // EXTENSION POINT: add "src/**/*.tsx" for React members
  ]
}
```

`package.json` (member root):
```jsonc
{
  "name": "@rosetta-poc/chat-<member>",  // EXTENSION POINT: member name, keep scope prefix
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",      // EXTENSION POINT: prepend/append build-tool step (e.g. "&& vite build")
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    // EXTENSION POINT: member-specific runtime deps; cross-member deps use "@rosetta-poc/chat-*": "0.0.0"
  }
}
```

Root `tsconfig.json` registers the member:
```jsonc
{
  "files": [],
  "references": [
    { "path": "./apps/api" },
    { "path": "./apps/web" },
    { "path": "./packages/shared" }
    // EXTENSION POINT: add new member path here when created
  ]
}
```
