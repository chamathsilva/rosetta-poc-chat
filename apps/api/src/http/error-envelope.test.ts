/**
 * SPECS §4.6 (FR-002, FR-010, AC-019, AC-021) — the redaction boundary.
 * The four named redaction fixtures: a stack-bearing Error, a SQLite error
 * carrying an SQL statement, an error whose message has an absolute file path,
 * and an error whose message has full message content. None of the forbidden
 * fragments may appear anywhere in the serialized envelope.
 */
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema, sendMessageRequestSchema } from "@rosetta-poc/chat-shared";
import {
  ContentValidationError,
  IdempotencyKeyConflictError,
  NotFoundError,
  PersistedRecordInvalidError,
  ResponseAlreadyActiveError,
} from "../domain/errors.js";
import { HTTP_STATUS_BY_CODE, RequestBodyError, routeNotFoundEnvelope, toErrorEnvelope } from "./error-envelope.js";

const REQUEST_ID = "req-7";
const CONTENT = "Zanzibar quokka telemetry marmalade 4815162342";
const FORBIDDEN = ["at ", "SELECT", "INSERT", "/Users", ".ts:", CONTENT] as const;
const INTERNAL = { error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: REQUEST_ID } };

function assertRedacted(err: unknown): string {
  const serialized = JSON.stringify(toErrorEnvelope(err, REQUEST_ID));
  for (const fragment of FORBIDDEN) {
    expect(serialized).not.toContain(fragment);
  }
  return serialized;
}

describe("AC-021 redaction fixtures", () => {
  it("fixture 1: a stack-bearing Error ⇒ INTERNAL_ERROR, no stack text", () => {
    const err = new Error("boom");
    err.stack = `Error: boom\n    at handler (/Users/dev/app/apps/api/src/http/server.ts:42:7)\n    at run (node:internal)`;
    assertRedacted(err);
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual(INTERNAL);
  });

  it("fixture 2: a SQLite error carrying an SQL statement ⇒ INTERNAL_ERROR, no SQL", () => {
    const err = Object.assign(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed while running INSERT INTO messages (content) VALUES ('x'); SELECT * FROM responses"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 2067,
      errstr: "constraint failed",
    });
    assertRedacted(err);
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual(INTERNAL);
  });

  it("fixture 3: an error whose message contains an absolute file path ⇒ INTERNAL_ERROR, no path", () => {
    const err = new TypeError("Cannot read properties of undefined at /Users/dev/app/apps/api/src/usecases/send-message.ts:88:12");
    assertRedacted(err);
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual(INTERNAL);
  });

  it("fixture 4: an error whose message contains full message content ⇒ INTERNAL_ERROR, no content", () => {
    const err = new Error(`provider exploded while echoing: ${CONTENT}`);
    assertRedacted(err);
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual(INTERNAL);
  });

  it.each([
    ["a thrown string", `SELECT ${CONTENT} at /Users/x.ts:1`],
    ["a thrown plain object", { message: CONTENT, sql: "INSERT INTO x" }],
    ["null", null],
    ["undefined", undefined],
  ])("%s ⇒ INTERNAL_ERROR, nothing echoed", (_label, thrown) => {
    assertRedacted(thrown);
    expect(toErrorEnvelope(thrown, REQUEST_ID)).toEqual(INTERNAL);
  });
});

describe("DomainError ⇒ its code + constant public message", () => {
  it.each([
    [new NotFoundError("conversation"), "NOT_FOUND", "Conversation not found."],
    [new IdempotencyKeyConflictError(), "IDEMPOTENCY_KEY_CONFLICT", "This clientMessageId was already used with different content."],
    [new ResponseAlreadyActiveError(), "RESPONSE_ALREADY_ACTIVE", "This conversation already has a response in progress."],
    [new ContentValidationError("too-long"), "VALIDATION_FAILED", "Message content must be at most 4000 characters."],
    [new PersistedRecordInvalidError(), "INTERNAL_ERROR", "Internal server error"],
  ] as const)("%s", (err, code, message) => {
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual({ error: { code, message, requestId: REQUEST_ID } });
  });
});

describe("ZodError ⇒ VALIDATION_FAILED with path + fixed message, never the received value", () => {
  it("details name the failing paths and use only the fixed issue map", () => {
    const result = sendMessageRequestSchema.safeParse({ clientMessageId: "", content: 42, [CONTENT]: CONTENT });
    expect(result.success).toBe(false);
    if (result.success) return;
    const envelope = toErrorEnvelope(result.error, REQUEST_ID);
    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(envelope.error.code).toBe("VALIDATION_FAILED");
    expect(envelope.error.message).toBe("Request validation failed.");
    const details = envelope.error.details ?? [];
    expect(details).toContainEqual({ path: "clientMessageId", message: "Value is too small." });
    expect(details).toContainEqual({ path: "content", message: "Value has the wrong type." });
    expect(details).toContainEqual({ path: "", message: "Object contains unknown fields." });
    expect(JSON.stringify(envelope)).not.toContain(CONTENT); // unknown key name is not echoed
    expect(JSON.stringify(envelope)).not.toContain("42");
  });
});

describe("request body failures ⇒ VALIDATION_FAILED without echoing the body", () => {
  it("RequestBodyError (malformed JSON)", () => {
    expect(toErrorEnvelope(new RequestBodyError(), REQUEST_ID)).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Request body could not be parsed.", requestId: REQUEST_ID },
    });
  });

  it("Fastify content-type parser errors (FST_ERR_CTP_*)", () => {
    const err = Object.assign(new Error(`Body is too large: ${CONTENT}`), { code: "FST_ERR_CTP_BODY_TOO_LARGE", statusCode: 413 });
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Request body could not be parsed.", requestId: REQUEST_ID },
    });
  });

  it("a non-body Fastify error code stays INTERNAL_ERROR", () => {
    const err = Object.assign(new Error("x"), { code: "FST_ERR_REP_ALREADY_SENT" });
    expect(toErrorEnvelope(err, REQUEST_ID)).toEqual(INTERNAL);
  });
});

describe("fixed HTTP status per code (SPECS §4.6 table)", () => {
  it("maps all 11 codes exactly", () => {
    expect(HTTP_STATUS_BY_CODE).toEqual({
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
    });
  });

  it("every envelope produced validates against the shared schema", () => {
    for (const err of [new Error("x"), new NotFoundError("response"), new RequestBodyError()]) {
      expect(errorEnvelopeSchema.safeParse(toErrorEnvelope(err, REQUEST_ID)).success).toBe(true);
    }
    expect(errorEnvelopeSchema.safeParse(routeNotFoundEnvelope(REQUEST_ID)).success).toBe(true);
  });
});
