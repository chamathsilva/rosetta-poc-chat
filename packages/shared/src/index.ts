/**
 * Barrel — packages/shared/src/index.ts. Re-exports the shared runtime
 * contracts and domain rules consumed by both apps/api and apps/web.
 * SPECS §2.1.
 */
export * from "./ids.js";

export * from "./contracts/conversation.js";
export * from "./contracts/message.js";
export * from "./contracts/response.js";
export * from "./contracts/events.js";
export * from "./contracts/errors.js";
export * from "./contracts/params.js";
export * from "./contracts/health.js";

export * from "./domain-rules/normalize.js";
export * from "./domain-rules/title.js";
export * from "./domain-rules/terminal.js";
