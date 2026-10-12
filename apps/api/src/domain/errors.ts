/**
 * Domain errors — apps/api/src/domain/errors.ts. SPECS §2.1, §4.6, §5.4
 * (FR-002, FR-010, AC-021). PURE: no IO, no zod.
 *
 * Redaction contract: every publicMessage is a module-level literal, never
 * interpolated with user or provider content. Error.message is set to the
 * same literal, so nothing sensitive can leak through it either. HTTP status
 * mapping belongs to http/error-envelope.ts, not here.
 */
import type { ErrorCode } from "@rosetta-poc/chat-shared";
import type { AppendCheck, TransitionCheck } from "./response-machine.js";

const INTERNAL_ERROR_MESSAGE = "Internal server error"; // SPECS §4.6 fixed string

const CONTENT_MESSAGES = {
  empty: "Message content must not be empty.",
  "too-long": "Message content must be at most 4000 characters.",
} as const;

const NOT_FOUND_MESSAGES = {
  conversation: "Conversation not found.",
  response: "Response not found.",
} as const;

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  readonly publicMessage: string;

  protected constructor(publicMessage: string) {
    super(publicMessage);
    this.name = new.target.name;
    this.publicMessage = publicMessage;
  }
}

/** Empty or >4000-code-point content after normalization (AC-019, SPECS §3.1). */
export class ContentValidationError extends DomainError {
  override readonly code = "VALIDATION_FAILED";
  readonly reason: keyof typeof CONTENT_MESSAGES;

  constructor(reason: keyof typeof CONTENT_MESSAGES) {
    super(CONTENT_MESSAGES[reason]);
    this.reason = reason;
  }
}

/** Header not ^\d{1,15}$ after trim (AC-012, SPECS §6.3). */
export class InvalidLastEventIdError extends DomainError {
  override readonly code = "INVALID_LAST_EVENT_ID";

  constructor() {
    super("Last-Event-ID must be a non-negative integer.");
  }
}

/** Last-Event-ID > maxSeq for the response (AC-012, SPECS §6.3). */
export class LastEventIdOutOfRangeError extends DomainError {
  override readonly code = "LAST_EVENT_ID_OUT_OF_RANGE";

  constructor() {
    super("Last-Event-ID is beyond the last event of this response.");
  }
}

export class NotFoundError extends DomainError {
  override readonly code = "NOT_FOUND";
  readonly entity: keyof typeof NOT_FOUND_MESSAGES;

  constructor(entity: keyof typeof NOT_FOUND_MESSAGES) {
    super(NOT_FOUND_MESSAGES[entity]);
    this.entity = entity;
  }
}

/** Same key, different normalized content (AC-009). */
export class IdempotencyKeyConflictError extends DomainError {
  override readonly code = "IDEMPOTENCY_KEY_CONFLICT";

  constructor() {
    super("This clientMessageId was already used with different content.");
  }
}

/** Retry target is not failed (FR-008, SPECS §3.4). */
export class ResponseNotFailedError extends DomainError {
  override readonly code = "RESPONSE_NOT_FAILED";

  constructor() {
    super("Only a failed response can be retried.");
  }
}

/** Retry target is itself a replacement (A-003). */
export class RetryNotAllowedError extends DomainError {
  override readonly code = "RETRY_NOT_ALLOWED";

  constructor() {
    super("A replacement response cannot be retried.");
  }
}

/** New send while the conversation has a pending/streaming response (SPECS §3.4a). */
export class ResponseAlreadyActiveError extends DomainError {
  override readonly code = "RESPONSE_ALREADY_ACTIVE";

  constructor() {
    super("This conversation already has a response in progress.");
  }
}

/** Process is draining (FR-011, SPECS §7.3, §7.5). */
export class ServiceUnavailableError extends DomainError {
  override readonly code = "SERVICE_UNAVAILABLE";

  constructor() {
    super("The server is shutting down.");
  }
}

/** SQLite open/health failure at request time (SPECS §4.6). */
export class DatabaseUnavailableError extends DomainError {
  override readonly code = "DATABASE_UNAVAILABLE";

  constructor() {
    super("The database is unavailable.");
  }
}

/** A row read back from SQLite failed its row schema (FR-010, SPECS §5.4); never surfaced. */
export class PersistedRecordInvalidError extends DomainError {
  override readonly code = "INTERNAL_ERROR";

  constructor() {
    super(INTERNAL_ERROR_MESSAGE);
  }
}

/**
 * A response-machine guard rejected a transition or event append (SPECS §2.2
 * terminal-once, §3.2). `reason` is for diagnostics only; the envelope stays
 * INTERNAL_ERROR.
 */
export class IllegalResponseStateError extends DomainError {
  override readonly code = "INTERNAL_ERROR";
  readonly reason: Exclude<TransitionCheck | AppendCheck, "ok">;

  constructor(reason: Exclude<TransitionCheck | AppendCheck, "ok">) {
    super(INTERNAL_ERROR_MESSAGE);
    this.reason = reason;
  }
}
