/**
 * Response entity contracts — packages/shared/src/contracts/response.ts.
 * SPECS §4.2 entity contracts table, §3.5 provider failure codes,
 * §4.3 endpoint contracts (retry accepted body).
 */
import { z } from "zod";
import {
  conversationIdSchema,
  isoTimestampSchema,
  messageIdSchema,
  responseIdSchema,
} from "../ids.js";

export const responseStatusSchema = z.enum(["pending", "streaming", "completed", "failed"]);
export type ResponseStatusValue = z.infer<typeof responseStatusSchema>;

export const providerFailureCodeSchema = z.enum([
  "PROVIDER_ERROR",
  "PROVIDER_DISCONNECTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_INTERRUPTED",
]);
export type ProviderFailureCodeValue = z.infer<typeof providerFailureCodeSchema>;

export const responseFailureSchema = z
  .object({
    code: providerFailureCodeSchema,
    message: z.string(),
  })
  .strict();
export type ResponseFailure = z.infer<typeof responseFailureSchema>;

export const responseSchema = z
  .object({
    id: responseIdSchema,
    conversationId: conversationIdSchema,
    userMessageId: messageIdSchema,
    assistantMessageId: messageIdSchema.nullable(),
    status: responseStatusSchema,
    partialText: z.string(),
    failure: responseFailureSchema.nullable(),
    retryOfResponseId: responseIdSchema.nullable(),
    retriedByResponseId: responseIdSchema.nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();
export type Response = z.infer<typeof responseSchema>;

/**
 * POST /api/responses/:responseId/retry response body — SPECS §4.3.
 * `responseId` is the (new or existing) replacement response; `retryOfResponseId`
 * is the original failed response that was retried.
 */
export const retryAcceptedSchema = z
  .object({
    conversationId: conversationIdSchema,
    responseId: responseIdSchema,
    retryOfResponseId: responseIdSchema,
  })
  .strict();
export type RetryAccepted = z.infer<typeof retryAcceptedSchema>;
