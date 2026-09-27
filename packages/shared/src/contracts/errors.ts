/**
 * Error envelope and error code schemas — packages/shared/src/contracts/errors.ts.
 * SPECS §4.6. 11 error codes, including the two user-directed-correction additions
 * (RESPONSE_ALREADY_ACTIVE, DATABASE_UNAVAILABLE), dated 2026-09-27.
 */
import { z } from "zod";

export const errorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "INVALID_LAST_EVENT_ID",
  "LAST_EVENT_ID_OUT_OF_RANGE",
  "NOT_FOUND",
  "IDEMPOTENCY_KEY_CONFLICT",
  "RESPONSE_NOT_FAILED",
  "RETRY_NOT_ALLOWED",
  "RESPONSE_ALREADY_ACTIVE",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
  "DATABASE_UNAVAILABLE",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorDetailSchema = z
  .object({
    path: z.string(),
    message: z.string(),
  })
  .strict();
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        requestId: z.string(),
        details: z.array(errorDetailSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
