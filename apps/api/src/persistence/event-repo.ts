/**
 * Stream event repository — apps/api/src/persistence/event-repo.ts. SPECS
 * §2.2, §5.2, §5.3, §6.2 (FR-004, FR-005, AC-003, AC-010, AC-011).
 * Statements are prepared once at construction; every method is synchronous.
 *
 * append is the single write path for response events (adoption #1 from
 * Option C). It must run inside the caller's UnitOfWork transaction: it
 * allocates seq = MAX(seq) + 1, runs the §3.2 checkAppend guard, and inserts
 * the canonical §6.2 payload. ux_stream_events_terminal stays the hard
 * terminal-once invariant behind the guard. Replay is always keyed by
 * response_id, so one response's events can never reach another (FR-005).
 */
import type { DatabaseSync } from "node:sqlite";
import { IllegalResponseStateError, NotFoundError } from "../domain/errors.js";
import { checkAppend, nextSeq } from "../domain/response-machine.js";
import type { ResponseId } from "../domain/types.js";
import type { EventRepo } from "../ports.js";
import {
  buildStreamEvent,
  eventRowSchema,
  flagRowSchema,
  maxSeqRowSchema,
  parseRow,
  parseRows,
  statusRowSchema,
  typeRowSchema,
} from "./row-contracts.js";

export function createEventRepo(db: DatabaseSync): EventRepo {
  const insertStmt = db.prepare(
    "INSERT INTO stream_events (response_id, seq, type, data, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const listAfterStmt = db.prepare(
    `SELECT response_id, seq, type, data, created_at FROM stream_events
     WHERE response_id = ? AND seq > ? ORDER BY seq ASC`,
  );
  const maxSeqStmt = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM stream_events WHERE response_id = ?",
  );
  const typesStmt = db.prepare(
    "SELECT type FROM stream_events WHERE response_id = ? ORDER BY seq ASC",
  );
  const hasTerminalStmt = db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM stream_events
       WHERE response_id = ? AND type IN ('response.completed', 'response.failed')
     ) AS flag`,
  );
  const responseStatusStmt = db.prepare("SELECT status FROM responses WHERE id = ?");

  function maxSeq(responseId: ResponseId): number {
    return parseRow(maxSeqRowSchema, maxSeqStmt.get(responseId)).max_seq;
  }

  return {
    append(responseId, type, data, createdAt) {
      if (!db.isTransaction) {
        throw new Error("EventRepo.append must run inside a UnitOfWork transaction");
      }
      const statusRow = responseStatusStmt.get(responseId);
      if (statusRow === undefined) {
        throw new NotFoundError("response");
      }
      const status = parseRow(statusRowSchema, statusRow).status;
      const existingTypes = parseRows(typeRowSchema, typesStmt.all(responseId)).map((r) => r.type);
      const check = checkAppend(status, existingTypes, type);
      if (check !== "ok") {
        throw new IllegalResponseStateError(check);
      }
      const seq = nextSeq(maxSeq(responseId));
      const event = buildStreamEvent(responseId, seq, type, data);
      insertStmt.run(responseId, seq, event.type, JSON.stringify(event.data), createdAt);
      return { ...event, responseId, seq, createdAt };
    },
    listAfter(responseId, afterSeq) {
      return parseRows(eventRowSchema, listAfterStmt.all(responseId, afterSeq));
    },
    maxSeq,
    hasTerminal(responseId) {
      return parseRow(flagRowSchema, hasTerminalStmt.get(responseId)).flag === 1;
    },
  };
}
