/**
 * Provider types — apps/api/src/provider/types.ts. SPECS §3.5 (FR-003,
 * AC-003, AC-016, AC-021). The Provider contract itself lives in ports.ts;
 * provider/* depends on ports.ts types only (SPECS §2.2).
 */
import type { ProviderChunk } from "../ports.js";

export type { Provider, ProviderChunk, ProviderInput } from "../ports.js";

export type ProviderFailureCode = Extract<ProviderChunk, { kind: "error" }>["code"];

/**
 * The only failure messages ever exposed to clients — never the thrown value
 * or a provider-supplied message (AC-021).
 */
export const PROVIDER_FAILURE_MESSAGES: Readonly<Record<ProviderFailureCode, string>> = {
  PROVIDER_ERROR: "The assistant could not complete this response.",
  PROVIDER_DISCONNECTED: "The assistant connection was lost.",
  PROVIDER_TIMEOUT: "The assistant took too long to respond.",
  PROVIDER_INTERRUPTED: "This response was interrupted by a server restart.",
};
