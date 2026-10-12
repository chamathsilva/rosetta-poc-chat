/**
 * Error envelope — apps/api/src/http/error-envelope.ts. SPECS §4.6 (FR-002,
 * FR-010, AC-019, AC-021). The redaction boundary: nothing from the thrown
 * value reaches the client except a DomainError's constant code/message or a
 * ZodError issue path.
 */
import {
  VALIDATION_ISSUE_MESSAGES,
  type ErrorCode,
  type ErrorEnvelope,
} from "@rosetta-poc/chat-shared";
import { z } from "zod";
import { DomainError } from "../domain/errors.js";

/** Fixed HTTP status per code (SPECS §4.6). */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  INVALID_LAST_EVENT_ID: 400,
  LAST_EVENT_ID_OUT_OF_RANGE: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  RESPONSE_NOT_FAILED: 409,
  RETRY_NOT_ALLOWED: 409,
  RESPONSE_ALREADY_ACTIVE: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  DATABASE_UNAVAILABLE: 503,
};

const INTERNAL_ERROR_MESSAGE = "Internal server error";
const REQUEST_VALIDATION_MESSAGE = "Request validation failed.";
const REQUEST_BODY_MESSAGE = "Request body could not be parsed.";
const ROUTE_NOT_FOUND_MESSAGE = "Route not found.";

/** Thrown by the JSON body parser in server.ts for a body that is not valid JSON. */
export class RequestBodyError extends Error {
  constructor() {
    super(REQUEST_BODY_MESSAGE);
    this.name = "RequestBodyError";
  }
}

/** Fastify content-type parser failures (unsupported media type, body too large, …). */
function isFastifyBodyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code.startsWith("FST_ERR_CTP_")
  );
}

export function toErrorEnvelope(err: unknown, requestId: string): ErrorEnvelope {
  if (err instanceof DomainError) {
    return { error: { code: err.code, message: err.publicMessage, requestId } };
  }
  if (err instanceof z.ZodError) {
    return {
      error: {
        code: "VALIDATION_FAILED",
        message: REQUEST_VALIDATION_MESSAGE,
        requestId,
        details: err.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: VALIDATION_ISSUE_MESSAGES[issue.code],
        })),
      },
    };
  }
  if (err instanceof RequestBodyError || isFastifyBodyError(err)) {
    return { error: { code: "VALIDATION_FAILED", message: REQUEST_BODY_MESSAGE, requestId } };
  }
  return { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE, requestId } };
}

/** Envelope for a path that matches no route. */
export function routeNotFoundEnvelope(requestId: string): ErrorEnvelope {
  return { error: { code: "NOT_FOUND", message: ROUTE_NOT_FOUND_MESSAGE, requestId } };
}
