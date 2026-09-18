# Seed Placeholder Module

## Name
Seed Placeholder Module

## Description
Every current workspace member exposes exactly one entry-point source file under `src/` that is an intentional, non-functional placeholder rather than real implementation. Each placeholder carries a doc comment (or inline text for the React case) stating that it is a seed, naming what will replace it, and pointing to the future experiment (`EXP-002`) where real implementation begins. Non-UI modules (`apps/api`, `packages/shared`) use a bare `export {}` to keep the file a valid ES module with zero runtime behavior; the UI module (`apps/web`) instead renders a minimal placeholder component, since a React entry point cannot be an empty export and still satisfy `index.html`'s mount target.

Use this pattern when adding a new seed-stage module to this repo (chat-seed-v1): do not implement real logic yet — mark the boundary explicitly so downstream contributors and agents know the file is a deliberate stub, not an oversight.

Found in (2+ literal occurrences, 3 total members follow the same intent):
- `apps/api/src/index.ts` — `export {}` + doc comment
- `packages/shared/src/index.ts` — `export {}` + doc comment
- `apps/web/src/main.tsx` — placeholder React component (UI variant of the same intent)

## Template/Example

Non-UI module entry point:
```typescript
/**
 * Intentionally empty <module purpose> seed.
 *
 * <What will live here> begins during EXP-002 after chat-seed-v1 has been recorded.
 * // EXTENSION POINT: update the "what" clause per module (routes/persistence/streaming, contracts, etc.)
 */
export {};
```

UI module entry point (when the module must render something to satisfy its mount target):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function SeedPlaceholder() {
  // EXTENSION POINT: replace with the real top-level component once implementation begins
  return (
    <main>
      <h1>Streaming Chat POC</h1>
      <p>Product implementation begins during EXP-002.</p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <SeedPlaceholder />
  </StrictMode>
);
```
