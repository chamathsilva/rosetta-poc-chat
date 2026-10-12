/**
 * Path-param schemas and Last-Event-ID header parsing —
 * packages/shared/src/contracts/params.ts. SPECS §6.3.
 *
 * parseLastEventId is a pure function: it returns only { kind: "ok", value }
 * or { kind: "malformed" }. The out-of-range decision (value > maxSeq) needs
 * the response's current maxSeq, which this function does not have access to;
 * that decision is made by the caller (INC-06's route handler).
 */
import { z } from "zod";
import { conversationIdSchema, responseIdSchema } from "../ids.js";

export const conversationParamsSchema = z
  .object({
    conversationId: conversationIdSchema,
  })
  .strict();
export type ConversationParams = z.infer<typeof conversationParamsSchema>;

export const responseParamsSchema = z
  .object({
    responseId: responseIdSchema,
  })
  .strict();
export type ResponseParams = z.infer<typeof responseParamsSchema>;

export type LastEventIdParse = { kind: "ok"; value: number } | { kind: "malformed" };

const LAST_EVENT_ID_PATTERN = /^\d{1,15}$/;

/**
 * Fixed rules (SPECS §6.3):
 * - header absent, "", or whitespace-only ⇒ { kind: "ok", value: 0 } (empty ≡ absent, R4).
 * - not ^\d{1,15}$ after trim ⇒ { kind: "malformed" }.
 * - leading zeros are accepted and parsed decimally ("007" ⇒ 7).
 */
export function parseLastEventId(header: string | undefined): LastEventIdParse {
  if (header === undefined) {
    return { kind: "ok", value: 0 };
  }
  const trimmed = header.trim();
  if (trimmed === "") {
    return { kind: "ok", value: 0 };
  }
  if (!LAST_EVENT_ID_PATTERN.test(trimmed)) {
    return { kind: "malformed" };
  }
  return { kind: "ok", value: Number.parseInt(trimmed, 10) };
}
