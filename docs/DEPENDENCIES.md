# DEPENDENCIES

Purpose: direct dependencies per package. Content: package + pinned version. Style: flat lists, current state only.

## Root (rosetta-poc-chat)
- typescript (7.0.2) — devDependency
- vite (8.3.0) — devDependency
- vitest (5.0.0) — devDependency
- @types/node (24.13.4) — devDependency
- @types/react (19.3.0) — devDependency
- @types/react-dom (19.3.0) — devDependency
- @vitejs/plugin-react (6.1.1) — devDependency
- @testing-library/react (16.3.3) — devDependency
- @testing-library/user-event (14.6.7) — devDependency
- jsdom (30.0.1) — devDependency

## @rosetta-poc/chat-api (apps/api)
### Dependencies
- fastify (5.12.4)
- @fastify/cors (11.3.0)
- zod (4.6.5)
- @rosetta-poc/chat-shared (0.0.0) — workspace

## @rosetta-poc/chat-web (apps/web)
### Dependencies
- react (19.3.0)
- react-dom (19.3.0)
- zod (4.6.5)
- @rosetta-poc/chat-shared (0.0.0) — workspace

### DevDependencies
- vite (8.3.0)
- @vitejs/plugin-react (6.1.1)

## @rosetta-poc/chat-shared (packages/shared)
### Dependencies
- zod (4.6.5)
