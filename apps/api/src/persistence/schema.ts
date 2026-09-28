/**
 * Schema — apps/api/src/persistence/schema.ts. SPECS §5.2 (FR-006, AC-005).
 * Deterministic DDL applied idempotently at container construction:
 * IF NOT EXISTS statements, in this fixed order, inside one transaction.
 * TEXT timestamps are ISO-8601 UTC ms.
 */
import type { DatabaseSync } from "node:sqlite";
import { createUnitOfWork } from "./unit-of-work.js";

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_seq INTEGER NOT NULL,
    has_user_message INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    client_message_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    user_message_id TEXT NOT NULL REFERENCES messages(id),
    assistant_message_id TEXT REFERENCES messages(id),
    status TEXT NOT NULL CHECK (status IN ('pending','streaming','completed','failed')),
    partial_text TEXT NOT NULL DEFAULT '',
    failure_code TEXT,
    failure_message TEXT,
    retry_of_response_id TEXT REFERENCES responses(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stream_events (
    response_id TEXT NOT NULL REFERENCES responses(id),
    seq INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN
      ('response.started','response.delta','response.completed','response.failed')),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (response_id, seq)
  )`,
  // Per-conversation ordering without wall clock (FR-006, AC-007).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_conversation_seq
    ON messages (conversation_id, seq)`,
  // Idempotency key scope (FR-009, AC-008, AC-009).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_idempotency
    ON messages (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL`,
  // At most one replacement per response (FR-008, AC-017).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_responses_retry_of
    ON responses (retry_of_response_id) WHERE retry_of_response_id IS NOT NULL`,
  // At most one active response per conversation (§3.4a, user-directed correction 2026-09-27).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_responses_one_active_per_conversation
    ON responses (conversation_id) WHERE status IN ('pending','streaming')`,
  // Terminal-once as a DB invariant (FR-004, AC-010).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_stream_events_terminal
    ON stream_events (response_id) WHERE type IN ('response.completed','response.failed')`,
  // List ordering (FR-001, FR-002, AC-007).
  `CREATE INDEX IF NOT EXISTS ix_conversations_updated_seq
    ON conversations (updated_seq DESC)`,
  // Active-response lookup and boot recovery scan (FR-006, AC-014).
  `CREATE INDEX IF NOT EXISTS ix_responses_conversation_status
    ON responses (conversation_id, status)`,
];

export function applySchema(db: DatabaseSync): void {
  createUnitOfWork(db).run(() => {
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
  });
}
