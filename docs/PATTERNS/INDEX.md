# PATTERNS INDEX

> This repository (chat-seed-v1) is an intentionally non-functional Rosetta POC seed. Only `apps/web`, `apps/api`, and `packages/shared` placeholder modules exist, with fixed workspace tooling config. No chat/API/streaming/persistence implementation exists yet, so no functional/domain code patterns (controllers, components, hooks, services, state machines, etc.) could be extracted — there is nothing recurring to extract beyond structural/tooling conventions. The two patterns below are the only ones that actually recur 2+ times in the current source. This INDEX will need a real pass once EXP-002 lands functional code.

## Workspace Package Structure - paired package.json + tsconfig.json per npm workspace member, extending tsconfig.base.json and wired into the root TS project-reference graph
## Seed Placeholder Module - single non-functional entry-point file per module, marked with a doc comment/placeholder UI pointing to the EXP-002 implementation milestone
