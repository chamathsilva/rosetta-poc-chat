/**
 * Response repository — apps/api/src/persistence/response-repo.ts. SPECS §3.2,
 * §5.2, §5.3, §5.6 (FR-004, FR-006, FR-008, AC-010, AC-014, AC-017).
 * Statements are prepared once at construction; every method is synchronous.
 *
 * Status writes (updateStatus, setCompleted, setFailed) pass the §3.2
 * checkTransition guard first, then update with `status = <from>` in the WHERE
 * clause and assert exactly one changed row. setCompleted and setFailed also
 * write the terminal status itself. A second active response in one
 * conversation is rejected by ux_responses_one_active_per_conversation; a
 * second replacement of one response by ux_responses_retry_of.
 */
import type { DatabaseSync } from "node:sqlite";
import { IllegalResponseStateError, NotFoundError } from "../domain/errors.js";
import { checkTransition } from "../domain/response-machine.js";
import type { ResponseId, ResponseStatus } from "../domain/types.js";
import type { ResponseRepo } from "../ports.js";
import { expectOneChange } from "./db.js";
import {
  parseRow,
  parseRows,
  responseIdRowSchema,
  responseRowSchema,
  statusRowSchema,
} from "./row-contracts.js";

export function createResponseRepo(db: DatabaseSync): ResponseRepo {
  const insertStmt = db.prepare(
    `INSERT INTO responses
       (id, conversation_id, user_message_id, status, retry_of_response_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
  );
  const findByIdStmt = db.prepare(
    `SELECT id, conversation_id, user_message_id, assistant_message_id, status, partial_text,
            failure_code, failure_message, retry_of_response_id, created_at, updated_at
     FROM responses WHERE id = ?`,
  );
  // Deterministic without wall clock: user message order, then original before its one replacement.
  const listByConversationStmt = db.prepare(
    `SELECT r.id AS id, r.conversation_id AS conversation_id, r.user_message_id AS user_message_id,
            r.assistant_message_id AS assistant_message_id, r.status AS status,
            r.partial_text AS partial_text, r.failure_code AS failure_code,
            r.failure_message AS failure_message, r.retry_of_response_id AS retry_of_response_id,
            r.created_at AS created_at, r.updated_at AS updated_at
     FROM responses r JOIN messages m ON m.id = r.user_message_id
     WHERE r.conversation_id = ?
     ORDER BY m.seq ASC, (r.retry_of_response_id IS NOT NULL) ASC`,
  );
  const findActiveByConversationStmt = db.prepare(
    `SELECT id, conversation_id, user_message_id, assistant_message_id, status, partial_text,
            failure_code, failure_message, retry_of_response_id, created_at, updated_at
     FROM responses WHERE conversation_id = ? AND status IN ('pending', 'streaming')`,
  );
  const findReplacementOfStmt = db.prepare(
    "SELECT id FROM responses WHERE retry_of_response_id = ?",
  );
  // At most one active response per conversation, so conversation_id is a total order.
  const listActiveStmt = db.prepare(
    `SELECT id, conversation_id, user_message_id, assistant_message_id, status, partial_text,
            failure_code, failure_message, retry_of_response_id, created_at, updated_at
     FROM responses WHERE status IN ('pending', 'streaming') ORDER BY conversation_id ASC`,
  );
  const statusStmt = db.prepare("SELECT status FROM responses WHERE id = ?");
  const updateStatusStmt = db.prepare(
    "UPDATE responses SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
  );
  const appendPartialTextStmt = db.prepare(
    "UPDATE responses SET partial_text = partial_text || ? WHERE id = ? AND status = 'streaming'",
  );
  const setCompletedStmt = db.prepare(
    `UPDATE responses SET status = 'completed', assistant_message_id = ?, updated_at = ?
     WHERE id = ? AND status = ?`,
  );
  const setFailedStmt = db.prepare(
    `UPDATE responses SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ?
     WHERE id = ? AND status = ?`,
  );

  /** Returns the current status after checking that `to` is a legal next status (SPECS §3.2). */
  function guardTransition(id: ResponseId, to: ResponseStatus): ResponseStatus {
    const row = statusStmt.get(id);
    if (row === undefined) {
      throw new NotFoundError("response");
    }
    const from = parseRow(statusRowSchema, row).status;
    const check = checkTransition(from, to);
    if (check !== "ok") {
      throw new IllegalResponseStateError(check);
    }
    return from;
  }

  return {
    insert(row) {
      insertStmt.run(
        row.id,
        row.conversationId,
        row.userMessageId,
        row.retryOfResponseId,
        row.createdAt,
        row.updatedAt,
      );
    },
    findById(id) {
      const row = findByIdStmt.get(id);
      return row === undefined ? null : parseRow(responseRowSchema, row);
    },
    listByConversation(id) {
      return parseRows(responseRowSchema, listByConversationStmt.all(id));
    },
    findActiveByConversation(id) {
      const row = findActiveByConversationStmt.get(id);
      return row === undefined ? null : parseRow(responseRowSchema, row);
    },
    findReplacementOf(id) {
      const row = findReplacementOfStmt.get(id);
      return row === undefined ? null : parseRow(responseIdRowSchema, row).id;
    },
    listActive() {
      return parseRows(responseRowSchema, listActiveStmt.all());
    },
    updateStatus(id, status, updatedAt) {
      const from = guardTransition(id, status);
      expectOneChange(updateStatusStmt.run(status, updatedAt, id, from));
    },
    appendPartialText(id, text) {
      expectOneChange(appendPartialTextStmt.run(text, id));
    },
    setCompleted(id, assistantMessageId, updatedAt) {
      const from = guardTransition(id, "completed");
      expectOneChange(setCompletedStmt.run(assistantMessageId, updatedAt, id, from));
    },
    setFailed(id, code, message, updatedAt) {
      const from = guardTransition(id, "failed");
      expectOneChange(setFailedStmt.run(code, message, updatedAt, id, from));
    },
  };
}
