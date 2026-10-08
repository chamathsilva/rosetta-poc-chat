/**
 * SPECS §5.1, §5.2 (FR-006, AC-005). Schema shape, pragmas, idempotent
 * re-application, and the AC-005 restart: a second container on the same
 * file sees every row of all four tables unchanged.
 */
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { createTempDb, type TempDb } from "../testing/temp-db.js";
import { closeDatabase, openDatabase } from "./db.js";
import { applySchema } from "./schema.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config = (dbPath: string): AppConfig => ({ dbPath, port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" });
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;

const owned: { dbs: DatabaseSync[]; temps: TempDb[] } = { dbs: [], temps: [] };
afterEach(() => {
  for (const db of owned.dbs.splice(0)) closeDatabase(db);
  for (const temp of owned.temps.splice(0)) temp.cleanup();
});

function tempDb(): TempDb {
  const temp = createTempDb();
  owned.temps.push(temp);
  return temp;
}

function master(db: DatabaseSync): unknown[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((row) => ({ ...row }));
}

function allRows(container: Container): Record<string, unknown[]> {
  return Object.fromEntries(
    TABLES.map((table) => [table, container.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))]),
  );
}

async function settle(container: Container): Promise<void> {
  while (container.registry.size > 0) {
    await Promise.allSettled([...container.registry].map((entry) => entry.promise));
  }
}

describe("schema (§5.2)", () => {
  it("creates exactly the four tables and seven named indexes", () => {
    const db = openDatabase(":memory:");
    owned.dbs.push(db);
    applySchema(db);
    const objects = master(db) as { type: string; name: string }[];
    expect(objects.filter((o) => o.type === "table").map((o) => o.name).sort()).toEqual(["conversations", "messages", "responses", "stream_events"]);
    expect(objects.filter((o) => o.type === "index").map((o) => o.name).sort()).toEqual([
      "ix_conversations_updated_seq",
      "ix_responses_conversation_status",
      "ux_messages_conversation_seq",
      "ux_messages_idempotency",
      "ux_responses_one_active_per_conversation",
      "ux_responses_retry_of",
      "ux_stream_events_terminal",
    ]);
  });

  it("is idempotent: applying it again on the same file leaves the schema unchanged", () => {
    const temp = tempDb();
    const first = openDatabase(temp.path);
    owned.dbs.push(first);
    applySchema(first);
    const before = master(first);
    applySchema(first);
    expect(master(first)).toEqual(before);
    closeDatabase(first);
    const reopened = openDatabase(temp.path);
    owned.dbs.push(reopened);
    applySchema(reopened);
    expect(master(reopened)).toEqual(before);
  });

  it("opens with WAL, foreign keys on and a 5000 ms busy timeout (§5.1)", () => {
    const temp = tempDb();
    const db = openDatabase(temp.path);
    owned.dbs.push(db);
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout).toBe(5000);
  });
});

describe("AC-005", () => {
  it("restart on the same file preserves all four tables", async () => {
    const temp = tempDb();
    const first = createContainer(config(temp.path), { clock: fakeClock(T0), ids: sequentialIds("a") });
    owned.dbs.push(first.db); // closed in teardown even if an assertion fails (close is idempotent)
    const { conversation } = first.serverDeps.createConversation();
    first.serverDeps.sendMessage({ conversationId: conversation.id, clientMessageId: "k-1", content: "persist me across restarts" });
    await settle(first);
    const before = allRows(first);
    const detailBefore = first.serverDeps.getConversation(conversation.id);
    closeDatabase(first.db);

    // Fixture check, independent of the code under test: every table really has rows.
    expect(before.conversations).toHaveLength(1);
    expect(before.messages).toHaveLength(2); // user + assistant
    expect(before.responses).toHaveLength(1);
    expect((before.stream_events ?? []).length).toBeGreaterThanOrEqual(3); // started, ≥1 delta, completed

    const second = createContainer(config(temp.path), { clock: fakeClock(T0), ids: sequentialIds("b") });
    owned.dbs.push(second.db);
    expect(second.recover()).toBe(0);
    expect(allRows(second)).toEqual(before);
    expect(second.serverDeps.getConversation(conversation.id)).toEqual(detailBefore);
  });
});
