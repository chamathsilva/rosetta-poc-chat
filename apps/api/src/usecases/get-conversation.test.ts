/**
 * SPECS §3.3, §4.2, §4.3 (FR-001, FR-002, FR-008, A-010, R8). Create, list and
 * get payload composition at container level with fakeClock + sequentialIds.
 */
import {
  createConversationResponseSchema,
  getConversationResponseSchema,
  listConversationsResponseSchema,
  type ConversationId,
} from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { NotFoundError } from "../domain/errors.js";
import { closeDatabase } from "../persistence/db.js";
import type { ProviderChunk } from "../ports.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };

const owned: Container[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  // On failure too: open every gate and abort every in-flight run, so settlement can never hang.
  for (const release of releases.splice(0)) release();
  for (const c of owned.splice(0)) {
    for (const entry of c.registry) entry.controller.abort();
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    closeDatabase(c.db);
  }
});

describe("create / list / get", () => {
  it("a new conversation has the placeholder title; the first message sets it once (60 code points, no ellipsis)", async () => {
    const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a") });
    owned.push(c);
    const created = c.serverDeps.createConversation();
    expect(createConversationResponseSchema.parse(created)).toEqual(created);
    expect(created.conversation.title).toBe("New conversation");

    const id = created.conversation.id;
    c.serverDeps.sendMessage({ conversationId: id, clientMessageId: "k-1", content: `  ${"word ".repeat(20)}  ` });
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    c.serverDeps.sendMessage({ conversationId: id, clientMessageId: "k-2", content: "a later message" });
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));

    const expectedTitle = "word word word word word word word word word word word word "; // 60 code points
    expect(expectedTitle.length).toBe(60);
    const list = c.serverDeps.listConversations();
    expect(listConversationsResponseSchema.parse(list)).toEqual(list);
    expect(list.conversations).toEqual([{ id, title: expectedTitle, updatedAt: T0 }]);
  });

  it("get returns all responses and activeResponse = the active one, or null", async () => {
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    releases.push(() => release());
    const c = createContainer(config, {
      clock: fakeClock(T0),
      ids: sequentialIds("a"),
      provider: {
        async *stream(): AsyncGenerator<ProviderChunk> {
          yield { kind: "delta", text: "Mock " };
          signal();
          await gate;
          yield { kind: "end" };
        },
      },
    });
    owned.push(c);
    const id = c.serverDeps.createConversation().conversation.id;
    const accepted = c.serverDeps.sendMessage({ conversationId: id, clientMessageId: "k-1", content: "hi" });
    await reached;
    const during = c.serverDeps.getConversation(id);
    expect(getConversationResponseSchema.parse(during)).toEqual(during);
    expect(during.activeResponse).toEqual(during.responses[0]);
    expect(during.activeResponse?.id).toBe(accepted.response.id);
    expect(during.activeResponse?.partialText).toBe("Mock ");

    release();
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    const after = c.serverDeps.getConversation(id);
    expect(after.activeResponse).toBeNull();
    expect(after.responses[0]?.status).toBe("completed");
    expect(after.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("get of an unknown conversation ⇒ NotFoundError", () => {
    const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a") });
    owned.push(c);
    expect(() => c.serverDeps.getConversation("00000000-0000-4000-8000-00000000ffff" as ConversationId)).toThrow(NotFoundError);
  });
});
