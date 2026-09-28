/**
 * Unit of work — apps/api/src/persistence/unit-of-work.ts. SPECS §5.1, §5.5
 * (FR-006, AC-006). Explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK around a
 * synchronous fn.
 *
 * No await exists anywhere in here, and none may exist inside fn: that absence
 * is what makes §5.5 atomicity and §6.4 STREAM-INV-1 hold. A fn that returns a
 * promise is rolled back and rejected, because anything after its first await
 * would run outside the transaction.
 */
import type { DatabaseSync } from "node:sqlite";
import type { UnitOfWork } from "../ports.js";

export function createUnitOfWork(db: DatabaseSync): UnitOfWork {
  return {
    run<T>(fn: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        if (result instanceof Promise) {
          throw new TypeError("UnitOfWork.run requires a synchronous function");
        }
        db.exec("COMMIT");
        return result;
      } catch (error) {
        // SQLite may already have rolled back on some errors; rethrow the original either way.
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }
        throw error;
      }
    },
  };
}
