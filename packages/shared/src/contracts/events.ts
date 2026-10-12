/**
 * SSE event payload schemas and the discriminated union —
 * packages/shared/src/contracts/events.ts. SPECS §6.2.
 *
 * CORRECTED shape (user-directed correction, 2026-09-27): responseCompletedDataSchema
 * carries the full persisted assistantMessage (§4.2 Message), not assistantMessageId+text,
 * so the client never has to re-fetch to render the final message.
 */
import { z } from "zod";
import { conversationIdSchema, responseIdSchema, seqSchema } from "../ids.js";
import { messageSchema } from "./message.js";
import { responseFailureSchema } from "./response.js";

export const responseStartedDataSchema = z
  .object({
    responseId: responseIdSchema,
    conversationId: conversationIdSchema,
    seq: seqSchema,
  })
  .strict();
export type ResponseStartedData = z.infer<typeof responseStartedDataSchema>;

export const responseDeltaDataSchema = z
  .object({
    responseId: responseIdSchema,
    seq: seqSchema,
    text: z.string(),
  })
  .strict();
export type ResponseDeltaData = z.infer<typeof responseDeltaDataSchema>;

export const responseCompletedDataSchema = z
  .object({
    responseId: responseIdSchema,
    seq: seqSchema,
    assistantMessage: messageSchema,
  })
  .strict();
export type ResponseCompletedData = z.infer<typeof responseCompletedDataSchema>;

export const responseFailedDataSchema = z
  .object({
    responseId: responseIdSchema,
    seq: seqSchema,
    failure: responseFailureSchema,
  })
  .strict();
export type ResponseFailedData = z.infer<typeof responseFailedDataSchema>;

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response.started"), data: responseStartedDataSchema }).strict(),
  z.object({ type: z.literal("response.delta"), data: responseDeltaDataSchema }).strict(),
  z.object({ type: z.literal("response.completed"), data: responseCompletedDataSchema }).strict(),
  z.object({ type: z.literal("response.failed"), data: responseFailedDataSchema }).strict(),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;
