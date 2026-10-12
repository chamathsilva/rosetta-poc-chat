/**
 * Ports — apps/api/src/ports.ts. SPECS §2.2 (ports), §3.5 (Provider), §5.3
 * (repositories). Signatures only. Every port except Provider is synchronous;
 * UnitOfWork.run must receive a synchronous fn (no await inside — SPECS §5.1,
 * §5.5, STREAM-INV-1).
 *
 * Plain interfaces; adapters are factory functions constructed only in
 * bootstrap/container.ts. persistence/* and provider/* depend on these types
 * only (SPECS §2.2 dependency rule).
 */
import type { ExistingSend } from "./domain/idempotency.js";
import type {
  Conversation,
  ConversationId,
  ConversationSummary,
  Message,
  MessageId,
  NewConversation,
  NewMessage,
  NewResponse,
  PersistedEvent,
  ProviderFailureCode,
  ResponseId,
  ResponseRecord,
  ResponseStatus,
  StreamEventData,
  StreamEventType,
} from "./domain/types.js";

export interface Clock {
  now(): string; // ISO-8601 UTC ms
}

export interface IdGenerator {
  next(): string; // opaque, injected (FR-003, AC-003)
}

export interface UnitOfWork {
  run<T>(fn: () => T): T; // sync: BEGIN IMMEDIATE/COMMIT/ROLLBACK
}

// Provider — SPECS §3.5 (FR-003, AC-003, AC-016).

export interface ProviderInput {
  readonly responseId: string;
  readonly normalizedContent: string;
}

export type ProviderChunk =
  | { readonly kind: "delta"; readonly text: string }
  | { readonly kind: "end" }
  | { readonly kind: "error"; readonly code: ProviderFailureCode; readonly message: string };

export interface Provider {
  stream(input: ProviderInput): AsyncIterable<ProviderChunk>;
}

// Repositories — SPECS §5.3 (FR-006). Every method is synchronous.

export interface ConversationRepo {
  insert(row: NewConversation): void;
  findById(id: ConversationId): Conversation | null;
  listSummaries(): readonly ConversationSummary[];
  touch(id: ConversationId, updatedAt: string): void; // allocates next updated_seq
  setTitleIfFirstUserMessage(id: ConversationId, title: string): void;
}

export interface MessageRepo {
  insert(row: NewMessage): void; // allocates conversation-scoped seq
  listByConversation(id: ConversationId): readonly Message[];
  findByIdempotencyKey(id: ConversationId, clientMessageId: string): ExistingSend | null;
}

export interface ResponseRepo {
  insert(row: NewResponse): void;
  findById(id: ResponseId): ResponseRecord | null;
  listByConversation(id: ConversationId): readonly ResponseRecord[];
  findActiveByConversation(id: ConversationId): ResponseRecord | null;
  findReplacementOf(id: ResponseId): ResponseId | null;
  listActive(): readonly ResponseRecord[]; // boot recovery
  updateStatus(id: ResponseId, status: ResponseStatus, updatedAt: string): void;
  appendPartialText(id: ResponseId, text: string): void;
  setCompleted(id: ResponseId, assistantMessageId: MessageId, updatedAt: string): void;
  setFailed(id: ResponseId, code: ProviderFailureCode, message: string, updatedAt: string): void;
}

export interface EventRepo {
  // Single write path for response state (adoption #1 from Option C): allocates
  // seq, calls checkAppend, inserts the row — inside the caller's transaction.
  append(
    responseId: ResponseId,
    type: StreamEventType,
    data: StreamEventData,
    createdAt: string,
  ): PersistedEvent;
  listAfter(responseId: ResponseId, afterSeq: number): readonly PersistedEvent[];
  maxSeq(responseId: ResponseId): number; // 0 when none
  hasTerminal(responseId: ResponseId): boolean;
}
