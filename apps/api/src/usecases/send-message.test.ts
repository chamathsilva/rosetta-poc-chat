/**
 * SPECS §3.4, §3.4a, §4.4, §5.5, §10 (FR-003, FR-006, FR-008, FR-009, AC-003,
 * AC-006, AC-008, AC-009, AC-016). Container-level integration against SQLite
 * with fakeClock + sequentialIds; provider runs are awaited through the
 * container's run registry and asserted terminal statuses, never sleeps.
 */
import type { ConversationId } from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContainer, type Container, type ContainerOverrides } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { ContentValidationError, IdempotencyKeyConflictError, NotFoundError } from "../domain/errors.js";
import { HTTP_STATUS_BY_CODE } from "../http/error-envelope.js";
import { closeDatabase } from "../persistence/db.js";
import type { Provider, ProviderChunk } from "../ports.js";
import { PROVIDER_FAILURE_MESSAGES } from "../provider/types.js";
import { countingProvider, disconnectingProvider } from "../testing/provider-doubles.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { sendMessage } from "./send-message.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;

const owned: Container[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  // On failure too: open every gate and abort every in-flight run, so settlement can never hang.
  for (const release of releases.splice(0)) release();
  for (const c of owned.splice(0)) {
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    closeDatabase(c.db);
  }
});

function container(overrides: ContainerOverrides = {}): Container {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), ...overrides });
  owned.push(c);
  return c;
}

/** Awaits every in-flight provider run (the §7.5 registry promises always settle). */
async function settle(c: Container): Promise<void> {
  while (c.registry.size > 0) {
    await Promise.allSettled([...c.registry].map((entry) => entry.promise));
  }
}

function snapshot(c: Container): Record<string, unknown[]> {
  return Object.fromEntries(TABLES.map((t) => [t, c.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
}

/** Yields one delta, signals, then waits for an explicit release before ending (keeps a response active). */
function gatedProvider(): { provider: Provider; reached: Promise<void>; release: () => void } {
  let release!: () => void;
  let signal!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { signal = resolve; });
  releases.push(() => release()); // registered immediately: teardown releases it even if a test fails first
  return {
    provider: {
      async *stream(): AsyncGenerator<ProviderChunk> {
        yield { kind: "delta", text: "Mock " };
        signal();
        await gate;
        yield { kind: "end" };
      },
    },
    reached,
    release,
  };
}

function newConversation(c: Container): ConversationId {
  return c.serverDeps.createConversation().conversation.id;
}

describe("AC-006", () => {
  it.each(["responses.insert", "conversations.touch"] as const)("injected fault leaves neither message nor response (fault at %s)", (target) => {
    const c = container();
    const conversationId = newConversation(c);
    const before = snapshot(c);
    const startRun = vi.fn();
    const fault = new Error("injected fault");
    const [repo, method] = target.split(".") as ["responses" | "conversations", "insert" | "touch"];
    const faulty = { ...c[repo], [method]: () => { throw fault; } };
    expect(() =>
      sendMessage(
        { uow: c.uow, conversations: c.conversations, messages: c.messages, responses: c.responses, clock: fakeClock(T0), ids: sequentialIds("b"), startRun, [repo]: faulty },
        { conversationId, clientMessageId: "k-1", content: "boom" },
      ),
    ).toThrow(fault);
    expect(snapshot(c)).toEqual(before);
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("AC-008", () => {
  it("duplicate key returns original IDs, full userMessage/response objects, runCount === 1", async () => {
    const gated = gatedProvider();
    const counting = countingProvider(gated.provider);
    const c = container({ provider: counting });
    const conversationId = newConversation(c);
    const input = { conversationId, clientMessageId: "k-1", content: "  hello world  " };

    const first = c.serverDeps.sendMessage(input);
    await gated.reached; // the first run is in flight (response active)
    const duplicate = c.serverDeps.sendMessage({ ...input, content: "hello world" }); // same normalized content
    const current = c.serverDeps.getConversation(conversationId);

    expect(duplicate.userMessage).toEqual(first.userMessage);
    expect(duplicate.response.id).toBe(first.response.id);
    expect(duplicate.response).toEqual(current.responses[0]); // the full, CURRENT response object
    expect(duplicate.response.status).toBe("streaming");

    gated.release();
    await settle(c);
    const afterCompletion = c.serverDeps.sendMessage(input);
    expect(afterCompletion.userMessage).toEqual(first.userMessage);
    expect(afterCompletion.response.id).toBe(first.response.id);
    expect(afterCompletion.response.status).toBe("completed");

    expect(counting.runCount).toBe(1);
    const final = c.serverDeps.getConversation(conversationId);
    expect(final.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(final.responses).toHaveLength(1);
  });
});

describe("AC-009", () => {
  it("same key different content ⇒ 409 and zero stored change", async () => {
    const c = container();
    const conversationId = newConversation(c);
    c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "original" });
    await settle(c);
    const before = snapshot(c);
    let caught: unknown;
    try {
      c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "different" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IdempotencyKeyConflictError);
    expect(HTTP_STATUS_BY_CODE[(caught as IdempotencyKeyConflictError).code]).toBe(409);
    expect(snapshot(c)).toEqual(before);
    expect(c.registry.size).toBe(0); // no provider run started
  });
});

describe("AC-016", () => {
  it("failing provider persists one failure event and keeps the user message + partial", async () => {
    const c = container({ provider: disconnectingProvider(1) });
    // Persist-then-emit: at the moment each event is published, it must already be readable from the database.
    const publishOriginal = c.hub.publish.bind(c.hub);
    const persistedAtPublish: boolean[] = [];
    const publish = vi.spyOn(c.hub, "publish").mockImplementation((event) => {
      persistedAtPublish.push(
        c.events.listAfter(event.responseId, event.seq - 1).some((stored) => stored.seq === event.seq && stored.type === event.type),
      );
      publishOriginal(event);
    });
    const conversationId = newConversation(c);
    const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "alpha beta gamma delta" });
    await settle(c);

    const events = c.events.listAfter(accepted.response.id, 0);
    expect(events.map((e) => [e.seq, e.type])).toEqual([[1, "response.started"], [2, "response.delta"], [3, "response.failed"]]);
    const failures = events.filter((e) => e.type === "response.failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.data).toEqual({
      responseId: accepted.response.id,
      seq: 3,
      failure: { code: "PROVIDER_DISCONNECTED", message: PROVIDER_FAILURE_MESSAGES.PROVIDER_DISCONNECTED },
    });
    // "Safe": the fixed message only — the double's own message never reaches storage or the stream.
    expect(JSON.stringify(events)).not.toContain("provider double failure");
    // Exactly one failure event was streamed, and every published event was already persisted when published.
    expect(publish.mock.calls.filter(([event]) => event.type === "response.failed")).toHaveLength(1);
    expect(persistedAtPublish).toEqual([true, true, true]);

    const detail = c.serverDeps.getConversation(conversationId);
    expect(detail.messages).toEqual([accepted.userMessage]); // user message kept, no assistant message
    expect(detail.responses[0]).toMatchObject({ status: "failed", partialText: "Mock reply: alpha ", failure: { code: "PROVIDER_DISCONNECTED" } });
  });
});

describe("§10 determinism (AC-003)", () => {
  it("the same normalized content through two independent containers yields byte-identical persisted event data", async () => {
    const run = async (): Promise<string[]> => {
      const c = container({ clock: fakeClock(T0), ids: sequentialIds("d") });
      const conversationId = newConversation(c);
      const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "The quick  brown\nfox 😀 世界 jumps" });
      await settle(c);
      expect(c.responses.findById(accepted.response.id)?.status).toBe("completed"); // terminal before comparing
      return (c.db.prepare("SELECT data FROM stream_events WHERE response_id = ? ORDER BY seq").all(accepted.response.id) as { data: string }[]).map((row) => row.data);
    };
    const first = await run();
    const second = await run();
    expect(first.length).toBeGreaterThanOrEqual(3); // started, ≥ 1 delta, completed — a complete, non-empty sequence
    expect(JSON.parse(first.at(-1) ?? "{}")).toHaveProperty("assistantMessage");
    expect(second).toEqual(first); // byte-for-byte, every event
  });
});

describe("validation and lookup failures write nothing", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["\n\t ", "empty"],
    ["x".repeat(4001), "too-long"],
    ["😀".repeat(4001), "too-long"],
  ])("content %# ⇒ ContentValidationError(%s), zero writes, no run", (content, reason) => {
    const c = container();
    const conversationId = newConversation(c);
    const before = snapshot(c);
    expect(() => c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content })).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED", reason }),
    );
    expect(() => c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content })).toThrow(ContentValidationError);
    expect(snapshot(c)).toEqual(before);
    expect(c.registry.size).toBe(0);
  });

  it("4000 code points (UTF-16 length 8000) is accepted", async () => {
    const c = container();
    const conversationId = newConversation(c);
    const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "😀".repeat(4000) });
    expect(accepted.userMessage.content.length).toBe(8000);
    await settle(c);
  });

  it("an unknown conversation ⇒ NotFoundError, zero writes", () => {
    const c = container();
    const before = snapshot(c);
    expect(() =>
      c.serverDeps.sendMessage({ conversationId: "00000000-0000-4000-8000-00000000ffff" as ConversationId, clientMessageId: "k", content: "hi" }),
    ).toThrow(NotFoundError);
    expect(snapshot(c)).toEqual(before);
  });
});
