/**
 * Server-side domain entities and status unions — apps/api/src/domain/types.ts.
 * SPECS §2.1, §3.2, §4.2, §5.2, §5.3, §6.2. Type-only: nothing is imported at
 * runtime (domain/* depends on nothing — SPECS §2.2 dependency rule).
 *
 * Wire entities (Conversation, ConversationSummary, Message) are the shared
 * contracts verbatim (AC-004). The New* / ResponseRecord / PersistedEvent
 * shapes are the §5.3 repository row types, derived column-for-column from the
 * §5.2 DDL. `seq` and `updated_seq` are absent from New* because the
 * repository allocates them inside the write transaction (§5.2 ordering
 * contract).
 */
import type {
  Conversation,
  ConversationId,
  ConversationSummary,
  Message,
  MessageId,
  ProviderFailureCodeValue,
  Response,
  ResponseId,
  ResponseStatus,
  StreamEvent,
  StreamEventType,
} from "@rosetta-poc/chat-shared";

export type {
  Conversation,
  ConversationId,
  ConversationSummary,
  Message,
  MessageId,
  ResponseId,
  ResponseStatus,
  StreamEventType,
};

/** SPECS §3.5 — the four provider failure codes stored in responses.failure_code. */
export type ProviderFailureCode = ProviderFailureCodeValue;

export type MessageRole = Message["role"];

/** conversations row at insert; updated_seq allocated, has_user_message = 0 (SPECS §5.2). */
export interface NewConversation {
  readonly id: ConversationId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** messages row at insert; conversation-scoped seq allocated by MessageRepo.insert (AC-007). */
export interface NewMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: MessageRole;
  readonly content: string;
  readonly clientMessageId: string | null; // idempotency key scope (FR-009)
  readonly createdAt: string;
}

/** responses row at insert; always inserted as "pending" with empty partial_text (SPECS §5.5). */
export interface NewResponse {
  readonly id: ResponseId;
  readonly conversationId: ConversationId;
  readonly userMessageId: MessageId;
  readonly retryOfResponseId: ResponseId | null; // non-null ⇒ replacement (AC-017, A-003)
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Stored response. The wire Response minus retriedByResponseId, which is
 * derived at read time from ux_responses_retry_of (SPECS §4.2).
 */
export type ResponseRecord = Omit<Response, "retriedByResponseId">;

type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/**
 * Event payload handed to EventRepo.append. `seq` is left out because append
 * allocates it and writes it into the stored data (SPECS §5.3, §6.2).
 */
export type StreamEventData = WithoutSeq<StreamEvent["data"]>;

/** stream_events row read back: the §6.2 event union plus its row columns (FR-004, AC-010). */
export type PersistedEvent = StreamEvent & {
  readonly responseId: ResponseId;
  readonly seq: number;
  readonly createdAt: string;
};
