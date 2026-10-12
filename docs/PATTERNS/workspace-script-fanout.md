# Workspace Script Fan-out

## Name
Workspace Script Fan-out

## Description
Root scripts `build` and `typecheck` fan out to every workspace with `--workspaces --if-present`; each package supplies same-named scripts. Tests are not fanned out: one root vitest config globs test files across `apps/**` and `packages/**`. A new package participates by defining `build`/`typecheck` and, for tests, matching an `include` glob.

## Template
```jsonc
// root package.json
"scripts": {
  "build": "npm run build --workspaces --if-present",
  "typecheck": "npm run typecheck --workspaces --if-present",
  "test": "vitest run --passWithNoTests",
  "check": "npm run typecheck && npm test && npm run build"
}
```
```ts
// root vitest.config.ts
export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts"], // EXTENSION: add globs for new package locations
    clearMocks: true
  }
});
```

## Sources
- package.json
- vitest.config.ts
- apps/api/package.json
- apps/web/package.json
- packages/shared/package.json
