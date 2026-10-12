/**
 * Retry eligibility — apps/api/src/domain/retry.ts. SPECS §3.4 (FR-008,
 * AC-017, A-003). PURE: no IO, no zod.
 */
import type { ResponseStatus } from "./types.js";

export interface RetryTarget {
  status: ResponseStatus;
  retryOfResponseId: string | null;
}

export type RetryDecision =
  | { kind: "start" }
  | { kind: "existing"; responseId: string }
  | { kind: "rejected"; code: "RETRY_NOT_ALLOWED" | "RESPONSE_NOT_FAILED" };

/** Check order is fixed and load-bearing (SPECS §3.4). */
export function classifyRetry(
  target: RetryTarget,
  existingReplacementId: string | null,
): RetryDecision {
  // (1) A replacement is never retryable, even when it failed (A-003).
  if (target.retryOfResponseId !== null) {
    return { kind: "rejected", code: "RETRY_NOT_ALLOWED" };
  }
  // (2) Repeated retry returns the existing replacement (AC-017).
  if (existingReplacementId !== null) {
    return { kind: "existing", responseId: existingReplacementId };
  }
  // (3) Only a failed response can be retried (FR-008).
  if (target.status !== "failed") {
    return { kind: "rejected", code: "RESPONSE_NOT_FAILED" };
  }
  // (4)
  return { kind: "start" };
}
