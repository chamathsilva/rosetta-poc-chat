/**
 * SPECS §5.6 (AC-014, A-002, A-003). A "crash" is simulated by writing a
 * pending or partially streamed response to a test-owned database file and
 * closing it without finishing; a fresh container on the same file then runs
 * boot recovery. Deterministic container-level evidence (fakeClock +
 * sequentialIds); the real-process restart is in bootstrap/shutdown.test.ts.
 */
import {
  messageIdSchema,
  responseIdSchema,
  type ConversationId,
  type MessageId,
  type ResponseId,
} from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { RetryNotAllowedError } from "../domain/errors.js";
import { closeDatabase } from "../persistence/db.js";
import { PROVIDER_FAILURE_MESSAGES } from "../provider/types.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { createTempDb, type TempDb } from "../testing/temp-db.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config = (dbPath: string): AppConfig => ({ dbPath, port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" });
const INTERRUPTED = { code: "PROVIDER_INTERRUPTED", message: PROVIDER_FAILURE_MESSAGES.PROVIDER_INTERRUPTED } as const;

const owned: { containers: Container[]; temps: TempDb[] } = { containers: [], temps: [] };
afterEach(async () => {
  for (const c of owned.containers.splice(0)) {
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    closeDatabase(c.db);
  }
  for (const temp of owned.temps.splice(0)) temp.cleanup();
});

function open(path: string, prefix: string): Container {
  const c = createContainer(config(path), { clock: fakeClock(T0), ids: sequentialIds(prefix) });
  owned.containers.push(c);
  return c;
}

interface Seeded {
  readonly conversationId: ConversationId;
  readonly userMessageId: MessageId;
  readonly responseId: ResponseId;
}

/** Writes a conversation, user message and pending response the way send-message does, with no provider run. */
function seedPending(c: Container, ids: { next(): string }, content: string): Seeded {
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const userMessageId = messageIdSchema.parse(ids.next());
  const responseId = responseIdSchema.parse(ids.next());
  c.uow.run(() => {
    c.messages.insert({ id: userMessageId, conversationId, role: "user", content, clientMessageId: "k-1", createdAt: T0 });
    c.responses.insert({ id: responseId, conversationId, userMessageId, retryOfResponseId: null, createdAt: T0, updatedAt: T0 });
    c.conversations.touch(conversationId, T0);
  });
  return { conversationId, userMessageId, responseId };
}

function crashSetup() {
  const temp = createTempDb();
  owned.temps.push(temp);
  const c = open(temp.path, "a");
  const ids = sequentialIds("e");
  const zero = seedPending(c, ids, "never started");
  const partial = seedPending(c, ids, "half streamed");
  c.uow.run(() => {
    c.events.append(partial.responseId, "response.started", { responseId: partial.responseId, conversationId: partial.conversationId }, T0);
    c.responses.updateStatus(partial.responseId, "streaming", T0);
    c.events.append(partial.responseId, "response.delta", { responseId: partial.responseId, text: "Mock reply: " }, T0);
    c.responses.appendPartialText(partial.responseId, "Mock reply: ");
  });
  const partialEventsBefore = c.events.listAfter(partial.responseId, 0);
  // Fixture checks, independent of recovery: both responses are active; zero vs two events.
  expect(c.responses.listActive().map((r) => r.status).sort()).toEqual(["pending", "streaming"]);
  expect(c.events.maxSeq(zero.responseId)).toBe(0);
  expect(partialEventsBefore.map((e) => e.type)).toEqual(["response.started", "response.delta"]);
  closeDatabase(c.db); // the "crash": no terminal event was ever written
  return { path: temp.path, zero, partial, partialEventsBefore };
}

describe("AC-014 boot recovery", () => {
  it("restart recovers a zero-event pending response to exactly [response.started@1, response.failed@2], status failed", () => {
    const { path, zero } = crashSetup();
    const restarted = open(path, "b");
    expect(restarted.recover()).toBe(2);
    expect(restarted.events.listAfter(zero.responseId, 0).map((e) => [e.seq, e.type])).toEqual([
      [1, "response.started"],
      [2, "response.failed"],
    ]);
    expect(restarted.events.listAfter(zero.responseId, 1)[0]?.data).toEqual({ responseId: zero.responseId, seq: 2, failure: INTERRUPTED });
    expect(restarted.responses.findById(zero.responseId)).toMatchObject({ status: "failed", partialText: "", failure: INTERRUPTED });
  });

  it("restart recovers a partial-stream response by appending exactly one response.failed at maxSeq+1, prior events and partial_text untouched", () => {
    const { path, partial, partialEventsBefore } = crashSetup();
    const restarted = open(path, "b");
    expect(restarted.recover()).toBe(2);
    const after = restarted.events.listAfter(partial.responseId, 0);
    expect(after.slice(0, 2)).toEqual(partialEventsBefore); // byte-identical prior events
    expect(after.map((e) => [e.seq, e.type])).toEqual([
      [1, "response.started"],
      [2, "response.delta"],
      [3, "response.failed"],
    ]);
    expect(after.filter((e) => e.type === "response.started")).toHaveLength(1); // never re-appended
    expect(restarted.responses.findById(partial.responseId)).toMatchObject({ status: "failed", partialText: "Mock reply: ", failure: INTERRUPTED });
  });

  it("recovery is idempotent, leaves nothing active, and recovered responses follow the normal retry rules", async () => {
    const { path, zero, partial } = crashSetup();
    const restarted = open(path, "b");
    expect(restarted.recover()).toBe(2);
    expect(restarted.recover()).toBe(0);
    expect(restarted.responses.listActive()).toEqual([]);
    expect(restarted.events.listAfter(zero.responseId, 0)).toHaveLength(2);
    expect(restarted.events.listAfter(partial.responseId, 0)).toHaveLength(3);

    // A recovered original is retryable once (A-002) …
    const replacement = restarted.serverDeps.retryResponse(zero.responseId).responseId;
    while (restarted.registry.size > 0) await Promise.allSettled([...restarted.registry].map((entry) => entry.promise));
    expect(restarted.responses.findById(replacement)?.status).toBe("completed");
    // … and a replacement is never retryable (A-003).
    expect(() => restarted.serverDeps.retryResponse(replacement)).toThrow(RetryNotAllowedError);
  });

  it("a completed response is untouched by recovery", async () => {
    const temp = createTempDb();
    owned.temps.push(temp);
    const first = open(temp.path, "a");
    const conversationId = first.serverDeps.createConversation().conversation.id;
    const accepted = first.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "finished before the crash" });
    while (first.registry.size > 0) await Promise.allSettled([...first.registry].map((entry) => entry.promise));
    const events = first.events.listAfter(accepted.response.id, 0);
    const record = first.responses.findById(accepted.response.id);
    closeDatabase(first.db);
    const restarted = open(temp.path, "b");
    expect(restarted.recover()).toBe(0);
    expect(restarted.events.listAfter(accepted.response.id, 0)).toEqual(events);
    expect(restarted.responses.findById(accepted.response.id)).toEqual(record);
  });
});
