# Patterns Index

Purpose: index of reusable code/config patterns. Content: one h2 per pattern with one-line description. Style: grep by header; no tables.

## Workspace Package Manifest - scoped private ESM package.json with build/typecheck scripts and exact-pinned deps
File: workspace-package-manifest.md

## Composite Package tsconfig - per-package tsconfig extending the base, composite, registered in root references
File: composite-package-tsconfig.md

## Workspace Script Fan-out - root scripts delegating to workspaces plus a single root vitest glob
File: workspace-script-fanout.md

## Coverage Gaps and Skips

Source code is a non-functional seed, so no code-level patterns exist; all patterns are configuration/packaging.

## Skipped - apps/api/src
Only `index.ts` (empty seed, `export {}`). No routes or handlers to compare.

## Skipped - apps/web/src
Only `main.tsx` (placeholder React root). Single file, no recurring structure.

## Skipped - packages/shared/src
Only `index.ts` (empty seed). The "intentionally empty seed" header in api and shared index.ts is a placeholder, not a pattern that survives a rewrite.

## Skipped - apps/web vite.config.ts and root vitest.config.ts
One config each, no second instance.

## Skipped - docs, agents, .claude
Documentation and tooling, not code.
