/**
 * SQLite handle — apps/api/src/persistence/db.ts. SPECS §5.1 (A-011 finalized,
 * FR-006). One long-lived synchronous DatabaseSync handle, opened here and
 * closed by bootstrap/shutdown.ts. No --experimental-sqlite flag on Node 24.21.0.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const IN_MEMORY_DB_PATH = ":memory:";

/** Creates the file's directory, opens the handle, then applies the pragmas in the §5.1 order. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== IN_MEMORY_DB_PATH) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

/**
 * Optimistic-guard assertion on statement.run().changes (SPECS §5.1). The
 * message is a constant; the edge maps this to INTERNAL_ERROR.
 */
export function expectOneChange(result: { readonly changes: number | bigint }): void {
  if (result.changes !== 1) {
    throw new Error("Expected exactly one row to change");
  }
}

/** Idempotent: a second close is a no-op (shutdown may be reached twice). */
export function closeDatabase(db: DatabaseSync): void {
  if (db.isOpen) {
    db.close();
  }
}
