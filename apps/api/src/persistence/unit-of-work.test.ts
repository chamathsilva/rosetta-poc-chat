/**
 * SPECS §5.1, §5.5 (FR-006, AC-006). BEGIN IMMEDIATE / COMMIT / ROLLBACK around
 * a synchronous function; no await may run inside it.
 */
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "./db.js";
import { applySchema } from "./schema.js";
import { createUnitOfWork } from "./unit-of-work.js";

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
  applySchema(db);
});
afterEach(() => {
  closeDatabase(db);
});

const T = "2026-09-28T10:00:00.000Z";
const insert = (id: string): void => {
  db.prepare("INSERT INTO conversations (id, title, created_at, updated_at, updated_seq) VALUES (?, 't', ?, ?, 1)").run(id, T, T);
};
const count = (): number => (db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;

describe("createUnitOfWork", () => {
  it("commits and returns the function's result", () => {
    const result = createUnitOfWork(db).run(() => {
      insert("c-1");
      return 42;
    });
    expect(result).toBe(42);
    expect(count()).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it("rolls back everything when the function throws, and rethrows the original error", () => {
    const fault = new Error("injected fault");
    expect(() =>
      createUnitOfWork(db).run(() => {
        insert("c-1");
        insert("c-2");
        throw fault;
      }),
    ).toThrow(fault);
    expect(count()).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it("rejects a Promise-returning function and rolls back its synchronous writes", () => {
    expect(() =>
      createUnitOfWork(db).run(async () => {
        insert("c-1");
      }),
    ).toThrow(TypeError);
    expect(count()).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it("a constraint violation inside the transaction rolls back the earlier writes too", () => {
    expect(() =>
      createUnitOfWork(db).run(() => {
        insert("c-1");
        insert("c-1"); // PRIMARY KEY violation
      }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(count()).toBe(0);
  });
});
