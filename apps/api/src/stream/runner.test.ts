/**
 * SPECS §2.2, §3.5, §6.2 (FR-003, FR-004, AC-010, AC-016). The runner persists
 * each event, then publishes it; every persisted stream is seq 1..n with one
 * start and one terminal event, and nothing is appended after the terminal.
 * Container-level, deterministic (fakeClock + sequentialIds).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container, type ContainerOverrides } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import type { PersistedEvent } from "../domain/types.js";
import { closeDatabase } from "../persistence/db.js";
import type { Provider, ProviderChunk } from "../ports.js";
import { PROVIDER_FAILURE_MESSAGES } from "../provider/types.js";
import { fakeClock } from "../testing/fake-clock.js";
import { failingProvider, throwingProvider } from "../testing/provider-doubles.js";
import { sequentialIds } from "../testing/sequential-ids.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const TERMINAL = new Set(["response.completed", "response.failed"]);

// Owned-resource cleanup stack: runs in reverse even when a test fails.
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function container(overrides: ContainerOverrides = {}): Container {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), ...overrides });
  cleanups.push(async () => {
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    closeDatabase(c.db);
  });
  return c;
}

async function settle(c: Container): Promise<void> {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
}

/** The AC-010 shape, written independently of the implementation. */
function assertStreamShape(events: readonly PersistedEvent[], terminal: "response.completed" | "response.failed"): void {
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  expect(events.filter((e) => e.type === "response.started")).toHaveLength(1);
  expect(events[0]?.type).toBe("response.started");
  expect(events.filter((e) => TERMINAL.has(e.type))).toHaveLength(1);
  expect(events.at(-1)?.type).toBe(terminal);
  for (const e of events) expect(e.data.seq).toBe(e.seq);
}

/**
 * Sends one message and waits for the run. The started event is published synchronously inside
 * sendMessage; every later publish is checked for persist-then-emit at the moment it happens.
 */
async function sendAndSettle(c: Container, content: string) {
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const published: PersistedEvent[] = [];
  const persistedAtPublish: boolean[] = [];
  const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content });
  const unsubscribe = c.hub.subscribe(accepted.response.id, {
    onEvent: (event) => {
      published.push(event);
      persistedAtPublish.push(c.events.listAfter(event.responseId, event.seq - 1).some((s) => s.seq === event.seq && s.type === event.type));
    },
    onClose: () => {},
  });
  cleanups.push(unsubscribe);
  await settle(c);
  return { accepted, events: c.events.listAfter(accepted.response.id, 0), published, persistedAtPublish };
}

describe("AC-010", () => {
  it("seq 1..n, one start, one terminal, nothing after terminal", async () => {
    // A provider that keeps producing chunks after its end chunk: nothing after the terminal may be stored.
    const chattyProvider: Provider = {
      async *stream(): AsyncGenerator<ProviderChunk> {
        yield { kind: "delta", text: "Mock " };
        yield { kind: "delta", text: "reply" };
        yield { kind: "end" };
        yield { kind: "delta", text: " AFTER-END" };
        yield { kind: "end" };
      },
    };
    const c = container({ provider: chattyProvider });
    const { accepted, events, published, persistedAtPublish } = await sendAndSettle(c, "hello");
    assertStreamShape(events, "response.completed");
    expect(events.map((e) => e.type)).toEqual(["response.started", "response.delta", "response.delta", "response.completed"]);
    expect(JSON.stringify(events)).not.toContain("AFTER-END");
    expect(published.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(persistedAtPublish).toEqual([true, true, true]);

    // A second run of the same, now terminal, response appends nothing either.
    c.startRun({ responseId: accepted.response.id, conversationId: accepted.conversationId, normalizedContent: "hello" });
    await settle(c);
    expect(c.events.listAfter(accepted.response.id, 0)).toEqual(events);
  });

  it("the default provider's stream has the AC-010 shape and the completed text equals the concatenated deltas", async () => {
    const c = container();
    const { events } = await sendAndSettle(c, "one two three four five");
    assertStreamShape(events, "response.completed");
    const text = events.flatMap((e) => (e.type === "response.delta" ? [e.data.text] : [])).join("");
    const completed = events.at(-1);
    expect(text).toBe("Mock reply: one two three four five");
    expect(completed?.type === "response.completed" ? completed.data.assistantMessage.content : null).toBe(text);
  });

  it.each([
    ["an error chunk", () => failingProvider("PROVIDER_TIMEOUT"), "PROVIDER_TIMEOUT"],
    ["a thrown error", () => throwingProvider(), "PROVIDER_ERROR"],
    [
      "a stream that ends without an end chunk",
      (): Provider => ({ async *stream(): AsyncGenerator<ProviderChunk> { yield { kind: "delta", text: "Mock " }; } }),
      "PROVIDER_ERROR",
    ],
  ] as const)("%s ⇒ the AC-010 shape with exactly one response.failed (%s)", async (_label, makeProvider, code) => {
    const c = container({ provider: makeProvider() });
    const { accepted, events, persistedAtPublish } = await sendAndSettle(c, "hello");
    assertStreamShape(events, "response.failed");
    expect(events.at(-1)?.data).toEqual({
      responseId: accepted.response.id,
      seq: events.length,
      failure: { code, message: PROVIDER_FAILURE_MESSAGES[code] },
    });
    expect(persistedAtPublish.length).toBeGreaterThan(0);
    expect(persistedAtPublish.every(Boolean)).toBe(true);
  });

  it("an aborted run ends with exactly one response.failed (PROVIDER_INTERRUPTED)", async () => {
    let signal!: () => void;
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    let finish: (() => void) | undefined;
    cleanups.push(() => finish?.()); // lets the suspended provider iterator finish on teardown
    const c = container({
      provider: {
        async *stream(): AsyncGenerator<ProviderChunk> {
          yield { kind: "delta", text: "Mock " };
          signal();
          await new Promise<void>((resolve) => { finish = resolve; });
          yield { kind: "end" };
        },
      },
    });
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "hello" });
    await reached;
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    const events = c.events.listAfter(accepted.response.id, 0);
    assertStreamShape(events, "response.failed");
    expect(events.at(-1)?.data).toMatchObject({ failure: { code: "PROVIDER_INTERRUPTED" } });
  });
});
