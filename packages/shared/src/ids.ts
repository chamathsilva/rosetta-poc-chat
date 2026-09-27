/**
 * Branded identifier and primitive schemas — packages/shared/src/ids.ts.
 * SPECS §4.1. Entity IDs are lowercase UUID v4 strings produced by the
 * injected IdGenerator (never SQLite lastInsertRowid, A-011). Branded types
 * make cross-ID mix-ups a compile error.
 */
import { z } from "zod";

export const conversationIdSchema = z.uuid().brand<"ConversationId">();
export type ConversationId = z.infer<typeof conversationIdSchema>;

export const messageIdSchema = z.uuid().brand<"MessageId">();
export type MessageId = z.infer<typeof messageIdSchema>;

export const responseIdSchema = z.uuid().brand<"ResponseId">();
export type ResponseId = z.infer<typeof responseIdSchema>;

/** Opaque client-supplied idempotency key — not normalized, not required to be a UUID. */
export const clientMessageIdSchema = z.string().min(1).max(128);
export type ClientMessageId = z.infer<typeof clientMessageIdSchema>;

/** Always UTC with milliseconds, e.g. 2026-09-27T10:00:00.000Z. */
export const isoTimestampSchema = z.iso.datetime({ offset: false });
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;

/** Per-response event sequence number: 1, 2, 3, ... */
export const seqSchema = z.int().positive();
export type Seq = z.infer<typeof seqSchema>;

/** Last-Event-ID value; 0 means "nothing applied". */
export const eventIdSchema = z.int().nonnegative();
export type EventId = z.infer<typeof eventIdSchema>;
