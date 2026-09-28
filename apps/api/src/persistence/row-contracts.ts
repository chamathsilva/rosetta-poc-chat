/**
 * Row re-validation — apps/api/src/persistence/row-contracts.ts. SPECS §5.4
 * (FR-010, AC-021). Every row read from SQLite is parsed by a strict Zod row
 * schema before it becomes a domain object; stream_events.data is JSON.parsed
 * and then parsed by the §6.2 payload schema. Any failure throws
 * PersistedRecordInvalidError (⇒ INTERNAL_ERROR at the edge, never surfaced).
 *
 * Column values are validated with the shared primitive schemas, so every
 * output carries the same branded ids and value sets as the wire contracts.
 */
import {
  clientMessageIdSchema,
  conversationIdSchema,
  isoTimestampSchema,
  messageIdSchema,
  providerFailureCodeSchema,
  responseIdSchema,
  responseStatusSchema,
  seqSchema,
  streamEventSchema,
  type StreamEvent,
} from "@rosetta-poc/chat-shared";
import { z } from "zod";
import { PersistedRecordInvalidError } from "../domain/errors.js";
import type { ExistingSend } from "../domain/idempotency.js";
import type {
  Conversation,
  ConversationSummary,
  Message,
  PersistedEvent,
  ResponseId,
  ResponseRecord,
  StreamEventData,
  StreamEventType,
} from "../domain/types.js";

export function parseRow<S extends z.ZodType>(schema: S, row: unknown): z.output<S> {
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new PersistedRecordInvalidError();
  }
  return result.data;
}

export function parseRows<S extends z.ZodType>(
  schema: S,
  rows: readonly unknown[],
): readonly z.output<S>[] {
  return rows.map((row) => parseRow(schema, row));
}

export const conversationRowSchema = z
  .object({
    id: conversationIdSchema,
    title: z.string(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
  })
  .strict()
  .transform(
    (row): Conversation => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

export const conversationSummaryRowSchema = z
  .object({
    id: conversationIdSchema,
    title: z.string(),
    updated_at: isoTimestampSchema,
  })
  .strict()
  .transform((row): ConversationSummary => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));

export const messageRowSchema = z
  .object({
    id: messageIdSchema,
    conversation_id: conversationIdSchema,
    seq: seqSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    client_message_id: clientMessageIdSchema.nullable(),
    created_at: isoTimestampSchema,
  })
  .strict()
  .transform(
    (row): Message => ({
      id: row.id,
      conversationId: row.conversation_id,
      seq: row.seq,
      role: row.role,
      content: row.content,
      clientMessageId: row.client_message_id,
      createdAt: row.created_at,
    }),
  );

/** failure_code and failure_message are both set or both NULL. */
export const responseRowSchema = z
  .object({
    id: responseIdSchema,
    conversation_id: conversationIdSchema,
    user_message_id: messageIdSchema,
    assistant_message_id: messageIdSchema.nullable(),
    status: responseStatusSchema,
    partial_text: z.string(),
    failure_code: providerFailureCodeSchema.nullable(),
    failure_message: z.string().nullable(),
    retry_of_response_id: responseIdSchema.nullable(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
  })
  .strict()
  .transform((row, ctx): ResponseRecord => {
    const { failure_code: code, failure_message: message } = row;
    if ((code === null) !== (message === null)) {
      ctx.issues.push({ code: "custom", message: "failure columns must be paired", input: row });
      return z.NEVER;
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      status: row.status,
      partialText: row.partial_text,
      failure: code !== null && message !== null ? { code, message } : null,
      retryOfResponseId: row.retry_of_response_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

/** messages ⋈ responses row backing MessageRepo.findByIdempotencyKey (FR-009). */
export const existingSendRowSchema = z
  .object({
    user_message_id: messageIdSchema,
    response_id: responseIdSchema,
    content: z.string(),
  })
  .strict()
  .transform(
    (row): ExistingSend => ({
      userMessageId: row.user_message_id,
      responseId: row.response_id,
      normalizedContent: row.content, // content is stored normalized (SPECS §3.1)
    }),
  );

/** The data column must parse as the §6.2 payload for its type, with matching seq and responseId. */
export const eventRowSchema = z
  .object({
    response_id: responseIdSchema,
    seq: seqSchema,
    type: z.string(),
    data: z.string(),
    created_at: isoTimestampSchema,
  })
  .strict()
  .transform((row, ctx): PersistedEvent => {
    let payload: unknown;
    try {
      payload = JSON.parse(row.data);
    } catch {
      ctx.issues.push({ code: "custom", message: "event data is not JSON", input: row.data });
      return z.NEVER;
    }
    const event = streamEventSchema.safeParse({ type: row.type, data: payload });
    if (
      !event.success ||
      event.data.data.seq !== row.seq ||
      event.data.data.responseId !== row.response_id
    ) {
      ctx.issues.push({ code: "custom", message: "event data does not match its row", input: row });
      return z.NEVER;
    }
    return { ...event.data, responseId: row.response_id, seq: row.seq, createdAt: row.created_at };
  });

export const statusRowSchema = z.object({ status: responseStatusSchema }).strict();
export const typeRowSchema = z
  .object({
    type: z.enum(["response.started", "response.delta", "response.completed", "response.failed"]),
  })
  .strict();
export const maxSeqRowSchema = z.object({ max_seq: z.int().nonnegative() }).strict();
export const flagRowSchema = z.object({ flag: z.union([z.literal(0), z.literal(1)]) }).strict();
export const responseIdRowSchema = z.object({ id: responseIdSchema }).strict();

/**
 * Write-side check for EventRepo.append: adds the allocated seq to the payload
 * and validates the full §6.2 event. The parsed output follows schema key
 * order, so the stored data string is canonical for identical input (AC-003).
 */
export function buildStreamEvent(
  responseId: ResponseId,
  seq: number,
  type: StreamEventType,
  data: StreamEventData,
): StreamEvent {
  const event = streamEventSchema.safeParse({ type, data: { ...data, seq } });
  if (!event.success || event.data.data.responseId !== responseId) {
    throw new PersistedRecordInvalidError();
  }
  return event.data;
}
