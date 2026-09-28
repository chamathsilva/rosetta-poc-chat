/**
 * Send idempotency and the one-active-response gate —
 * apps/api/src/domain/idempotency.ts. SPECS §3.4, §3.4a (FR-009, AC-008,
 * AC-009; one-active-response gate: user-directed correction 2026-09-27).
 * PURE: no IO, no zod.
 */

/** The original send stored under a (conversationId, clientMessageId) key. */
export interface ExistingSend {
  userMessageId: string;
  responseId: string;
  normalizedContent: string;
}

export type IdempotencyDecision =
  | { kind: "new" }
  | { kind: "duplicate"; userMessageId: string; responseId: string }
  | { kind: "conflict" };

/**
 * existing === null ⇒ new; same key + byte-identical normalized content ⇒
 * duplicate with the original IDs (AC-008); same key + different normalized
 * content ⇒ conflict (AC-009).
 */
export function classifySend(
  existing: ExistingSend | null,
  incomingNormalized: string,
): IdempotencyDecision {
  if (existing === null) {
    return { kind: "new" };
  }
  if (existing.normalizedContent === incomingNormalized) {
    return {
      kind: "duplicate",
      userMessageId: existing.userMessageId,
      responseId: existing.responseId,
    };
  }
  return { kind: "conflict" };
}

export type SendGate = "ok" | "blocked";

/**
 * §3.4a. Evaluate ONLY after classifySend returned { kind: "new" } — a
 * duplicate replay of the send that owns the active response must still
 * succeed (SPECS §4.4, §5.5 step 2b).
 */
export function checkActiveResponseGate(hasActiveResponse: boolean): SendGate {
  return hasActiveResponse ? "blocked" : "ok";
}
