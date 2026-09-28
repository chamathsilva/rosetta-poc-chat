/**
 * Conversation repository — apps/api/src/persistence/conversation-repo.ts.
 * SPECS §5.2, §5.3 (FR-001, FR-002, FR-006, AC-007). Statements are prepared
 * once at construction; every method is synchronous.
 *
 * updated_seq is a global monotone counter allocated in the same statement as
 * its write, inside the caller's transaction; Clock never takes part in
 * ordering (§5.2 ordering contract).
 */
import type { DatabaseSync } from "node:sqlite";
import type { ConversationRepo } from "../ports.js";
import { expectOneChange } from "./db.js";
import {
  conversationRowSchema,
  conversationSummaryRowSchema,
  parseRow,
  parseRows,
} from "./row-contracts.js";

export function createConversationRepo(db: DatabaseSync): ConversationRepo {
  const insertStmt = db.prepare(
    `INSERT INTO conversations (id, title, created_at, updated_at, updated_seq, has_user_message)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(updated_seq), 0) + 1 FROM conversations), 0)`,
  );
  const findByIdStmt = db.prepare(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?",
  );
  const listSummariesStmt = db.prepare(
    "SELECT id, title, updated_at FROM conversations ORDER BY updated_seq DESC, id ASC",
  );
  const touchStmt = db.prepare(
    `UPDATE conversations
     SET updated_at = ?, updated_seq = (SELECT COALESCE(MAX(updated_seq), 0) + 1 FROM conversations)
     WHERE id = ?`,
  );
  // Title is written once, with the first user message, and never recomputed (SPECS §3.3, §5.5 step 4).
  const setTitleStmt = db.prepare(
    "UPDATE conversations SET title = ?, has_user_message = 1 WHERE id = ? AND has_user_message = 0",
  );

  return {
    insert(row) {
      insertStmt.run(row.id, row.title, row.createdAt, row.updatedAt);
    },
    findById(id) {
      const row = findByIdStmt.get(id);
      return row === undefined ? null : parseRow(conversationRowSchema, row);
    },
    listSummaries() {
      return parseRows(conversationSummaryRowSchema, listSummariesStmt.all());
    },
    touch(id, updatedAt) {
      expectOneChange(touchStmt.run(updatedAt, id));
    },
    setTitleIfFirstUserMessage(id, title) {
      setTitleStmt.run(title, id);
    },
  };
}
