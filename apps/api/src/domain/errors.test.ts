/**
 * SPECS §4.6, §5.4 (FR-002, FR-010, AC-021). Each DomainError carries its
 * stable code and a constant public message; Error.message equals that
 * constant, so nothing received can leak through either.
 */
import { describe, expect, it } from "vitest";
import {
  ContentValidationError,
  DatabaseUnavailableError,
  DomainError,
  IdempotencyKeyConflictError,
  IllegalResponseStateError,
  InvalidLastEventIdError,
  LastEventIdOutOfRangeError,
  NotFoundError,
  PersistedRecordInvalidError,
  ResponseAlreadyActiveError,
  ResponseNotFailedError,
  RetryNotAllowedError,
  ServiceUnavailableError,
} from "./errors.js";

const cases: ReadonlyArray<readonly [string, () => DomainError, string]> = [
  ["ContentValidationError(empty)", () => new ContentValidationError("empty"), "VALIDATION_FAILED"],
  ["ContentValidationError(too-long)", () => new ContentValidationError("too-long"), "VALIDATION_FAILED"],
  ["InvalidLastEventIdError", () => new InvalidLastEventIdError(), "INVALID_LAST_EVENT_ID"],
  ["LastEventIdOutOfRangeError", () => new LastEventIdOutOfRangeError(), "LAST_EVENT_ID_OUT_OF_RANGE"],
  ["NotFoundError(conversation)", () => new NotFoundError("conversation"), "NOT_FOUND"],
  ["NotFoundError(response)", () => new NotFoundError("response"), "NOT_FOUND"],
  ["IdempotencyKeyConflictError", () => new IdempotencyKeyConflictError(), "IDEMPOTENCY_KEY_CONFLICT"],
  ["ResponseNotFailedError", () => new ResponseNotFailedError(), "RESPONSE_NOT_FAILED"],
  ["RetryNotAllowedError", () => new RetryNotAllowedError(), "RETRY_NOT_ALLOWED"],
  ["ResponseAlreadyActiveError", () => new ResponseAlreadyActiveError(), "RESPONSE_ALREADY_ACTIVE"],
  ["ServiceUnavailableError", () => new ServiceUnavailableError(), "SERVICE_UNAVAILABLE"],
  ["DatabaseUnavailableError", () => new DatabaseUnavailableError(), "DATABASE_UNAVAILABLE"],
  ["PersistedRecordInvalidError", () => new PersistedRecordInvalidError(), "INTERNAL_ERROR"],
  ["IllegalResponseStateError", () => new IllegalResponseStateError("terminal-exists"), "INTERNAL_ERROR"],
];

describe("DomainError subclasses", () => {
  it.each(cases)("%s ⇒ %s with a constant public message", (_name, make, code) => {
    const error = make();
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.publicMessage.length).toBeGreaterThan(0);
    expect(error.message).toBe(error.publicMessage);
    expect(make().publicMessage).toBe(error.publicMessage); // constant across instances
  });

  it("names are the subclass names", () => {
    expect(new NotFoundError("response").name).toBe("NotFoundError");
    expect(new IllegalResponseStateError("already-terminal").name).toBe("IllegalResponseStateError");
  });

  it("internal errors expose only the fixed internal message; the diagnostic reason stays off the public message", () => {
    expect(new PersistedRecordInvalidError().publicMessage).toBe("Internal server error");
    const illegal = new IllegalResponseStateError("already-started");
    expect(illegal.publicMessage).toBe("Internal server error");
    expect(illegal.reason).toBe("already-started");
    expect(illegal.message).not.toContain("already-started");
  });

  it("not-found messages distinguish the entity with fixed text", () => {
    expect(new NotFoundError("conversation").publicMessage).toBe("Conversation not found.");
    expect(new NotFoundError("response").publicMessage).toBe("Response not found.");
  });

  it("content validation messages are fixed per reason", () => {
    expect(new ContentValidationError("empty").publicMessage).toBe("Message content must not be empty.");
    expect(new ContentValidationError("too-long").publicMessage).toBe("Message content must be at most 4000 characters.");
  });
});
