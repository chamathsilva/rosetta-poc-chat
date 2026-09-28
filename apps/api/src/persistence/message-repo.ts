/**
 * Message repository — apps/api/src/persistence/message-repo.ts. SPECS §5.2,
 * §5.3 (FR-006, FR-009, AC-007, AC-008, AC-009). Statements are prepared once
 * at construction; every method is synchronous.
 *
 * seq is conversation-scoped and allocated in the insert statement itself,
 * inside the caller's transaction. A duplicate (conversation_id,
 * client_message_id) is rejected by ux_messages_idempotency.
 */
import type { DatabaseSync } from "node:sqlite";
import type { MessageRepo } from "../ports.js";
import { existingSendRowSchema, messageRowSchema, parseRow, parseRows } from "./row-contracts.js";

export function createMessageRepo(db: DatabaseSync): MessageRepo {
  const insertStmt = db.prepare(
    `INSERT INTO messages (id, conversation_id, seq, role, content, client_message_id, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ?), ?, ?, ?, ?)`,
  );
  const listByConversationStmt = db.prepare(
    `SELECT id, conversation_id, seq, role, content, client_message_id, created_at
     FROM messages WHERE conversation_id = ? ORDER BY seq ASC`,
  );
  // The original send's response is the one that is not a replacement (retry_of_response_id IS NULL).
  const findByIdempotencyKeyStmt = db.prepare(
    `SELECT m.id AS user_message_id, r.id AS response_id, m.content AS content
     FROM messages m
     JOIN responses r ON r.user_message_id = m.id AND r.retry_of_response_id IS NULL
     WHERE m.conversation_id = ? AND m.client_message_id = ?`,
  );

  return {
    insert(row) {
      insertStmt.run(
        row.id,
        row.conversationId,
        row.conversationId,
        row.role,
        row.content,
        row.clientMessageId,
        row.createdAt,
      );
    },
    listByConversation(id) {
      return parseRows(messageRowSchema, listByConversationStmt.all(id));
    },
    findByIdempotencyKey(id, clientMessageId) {
      const row = findByIdempotencyKeyStmt.get(id, clientMessageId);
      return row === undefined ? null : parseRow(existingSendRowSchema, row);
    },
  };
}
