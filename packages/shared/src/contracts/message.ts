/**
 * Message entity contracts and send-message endpoint schemas —
 * packages/shared/src/contracts/message.ts. SPECS §4.2, §4.3, §4.4.
 *
 * CORRECTED shape (user-directed correction, 2026-09-27): sendMessageAcceptedSchema
 * carries the full userMessage and response objects, not bare IDs, so the client
 * never needs a follow-up GET to learn what it just idempotently replayed (§4.4).
 */
import { z } from "zod";
import {
  clientMessageIdSchema,
  conversationIdSchema,
  isoTimestampSchema,
  messageIdSchema,
  seqSchema,
} from "../ids.js";
import { responseSchema } from "./response.js";

export const messageSchema = z
  .object({
    id: messageIdSchema,
    conversationId: conversationIdSchema,
    seq: seqSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    clientMessageId: z.string().nullable(),
    createdAt: isoTimestampSchema,
  })
  .strict();
export type Message = z.infer<typeof messageSchema>;

export const sendMessageRequestSchema = z
  .object({
    clientMessageId: clientMessageIdSchema,
    content: z.string(),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageAcceptedSchema = z
  .object({
    conversationId: conversationIdSchema,
    userMessage: messageSchema,
    response: responseSchema,
  })
  .strict();
export type SendMessageAccepted = z.infer<typeof sendMessageAcceptedSchema>;
