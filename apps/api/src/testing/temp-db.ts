/**
 * Temporary database path — apps/api/src/testing/temp-db.ts. SPECS §10
 * (AC-005, AC-024). Each call gives a fresh directory from
 * node:fs.mkdtempSync under the OS temp directory, so tests never share a
 * database file. Pass `path` as config.dbPath; call cleanup() after closing
 * the database. `:memory:` stays an alternative when no file is needed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDb {
  /** Database file path inside the fresh directory (the file itself does not exist yet). */
  readonly path: string;
  /** Removes the directory and every file in it (database, -wal, -shm). */
  cleanup(): void;
}

export function createTempDb(): TempDb {
  const directory = mkdtempSync(join(tmpdir(), "chat-poc-"));
  return {
    path: join(directory, "chat.sqlite"),
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
