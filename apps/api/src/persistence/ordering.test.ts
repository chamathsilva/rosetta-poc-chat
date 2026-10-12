/**
 * SPECS §2.2, §5.2 ordering contract (FR-006, AC-007). With a clock that never
 * advances, every timestamp is identical; order must still come from the
 * allocated sequences, stay stable across calls, and survive a reopen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { createTempDb, type TempDb } from "../testing/temp-db.js";
import { closeDatabase } from "./db.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config = (dbPath: string): AppConfig => ({ dbPath, port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" });

const owned: { containers: Container[]; temps: TempDb[] } = { containers: [], temps: [] };
afterEach(async () => {
  for (const c of owned.containers.splice(0)) {
    await settle(c);
    closeDatabase(c.db);
  }
  for (const temp of owned.temps.splice(0)) temp.cleanup();
});

async function settle(container: Container): Promise<void> {
  while (container.registry.size > 0) {
    await Promise.allSettled([...container.registry].map((entry) => entry.promise));
  }
}

describe("AC-007", () => {
  it("identical timestamps keep list and history order", async () => {
    const temp = createTempDb();
    owned.temps.push(temp);
    const c = createContainer(config(temp.path), { clock: fakeClock(T0), ids: sequentialIds("a") });
    owned.containers.push(c); // closed in teardown even if an assertion fails (close is idempotent)

    const first = c.serverDeps.createConversation().conversation;
    const second = c.serverDeps.createConversation().conversation;
    const third = c.serverDeps.createConversation().conversation;
    // Fixture check: the clock really did not move.
    expect(new Set([first.createdAt, second.createdAt, third.createdAt])).toEqual(new Set([T0]));

    // List: most recently touched first (updated_seq DESC), never by timestamp.
    const listed = (): string[] => c.serverDeps.listConversations().conversations.map((s) => s.id);
    expect(listed()).toEqual([third.id, second.id, first.id]);
    expect(listed()).toEqual(listed()); // stable across calls

    // Sending into the oldest conversation touches it, moving it to the top.
    c.serverDeps.sendMessage({ conversationId: first.id, clientMessageId: "k-1", content: "one" });
    await settle(c);
    c.serverDeps.sendMessage({ conversationId: first.id, clientMessageId: "k-2", content: "two" });
    await settle(c);
    expect(listed()).toEqual([first.id, third.id, second.id]);

    // History: seq order (user, assistant, user, assistant), all with the same timestamp.
    const history = c.serverDeps.getConversation(first.id).messages;
    expect(history.map((m) => [m.seq, m.role, m.content])).toEqual([
      [1, "user", "one"],
      [2, "assistant", "Mock reply: one"],
      [3, "user", "two"],
      [4, "assistant", "Mock reply: two"],
    ]);
    expect(new Set(history.map((m) => m.createdAt))).toEqual(new Set([T0]));

    // The same order after a reopen on the same file.
    const listBefore = listed();
    closeDatabase(c.db);
    const reopened = createContainer(config(temp.path), { clock: fakeClock(T0), ids: sequentialIds("b") });
    owned.containers.push(reopened);
    expect(reopened.serverDeps.listConversations().conversations.map((s) => s.id)).toEqual(listBefore);
    expect(reopened.serverDeps.getConversation(first.id).messages).toEqual(history);
  });
});
