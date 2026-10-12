/**
 * SPECS §2.2 STREAM-INV-1, §6.4 (FR-005, AC-010, AC-011). attachResponseStream
 * over the real repositories and hub: replay then live with no gap and no
 * duplicate, terminal close, zero-frame close at maxSeq, response isolation,
 * and subscriber cleanup when a synchronous read or sink write fails.
 * Container-level, deterministic (fakeClock + sequentialIds); provider runs are
 * gated so mid-stream states are explicit.
 */
import type { ResponseId } from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import type { PersistedEvent } from "../domain/types.js";
import { closeDatabase } from "../persistence/db.js";
import type { EventRepo, Provider, ProviderChunk } from "../ports.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import type { StreamHub } from "./hub.js";
import { attachResponseStream, type StreamSink } from "./subscribe.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const FULL_TEXT = "Mock reply: one two three four five six seven";

// Owned-resource cleanup stack: runs in reverse even when a test fails.
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function settle(c: Container): Promise<void> {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
}

function container(provider?: Provider): Container {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), ...(provider === undefined ? {} : { provider }) });
  cleanups.push(async () => {
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    closeDatabase(c.db);
  });
  return c;
}

/** Yields the deterministic chunks of FULL_TEXT, pausing after `pauseAfter` deltas until released. */
function gatedProvider(pauseAfter: number): { provider: Provider; reached: Promise<void>; release: () => void } {
  const chunks = ["Mock reply: one ", "two three four ", "five six seven"];
  let release!: () => void;
  let signal!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { signal = resolve; });
  cleanups.push(() => release()); // registered immediately: teardown releases it even if a test fails
  return {
    provider: {
      async *stream(): AsyncGenerator<ProviderChunk> {
        for (const [index, text] of chunks.entries()) {
          if (index === pauseAfter) {
            signal();
            await gate;
          }
          yield { kind: "delta", text };
        }
        yield { kind: "end" };
      },
    },
    reached,
    release,
  };
}

/** Wraps the hub to count live subscriptions (each unsubscribe counted once). */
function countingHub(hub: StreamHub): StreamHub & { active(): number } {
  let active = 0;
  return {
    ...hub,
    active: () => active,
    subscribe(responseId, subscriber) {
      active += 1;
      const unsubscribe = hub.subscribe(responseId, subscriber);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          active -= 1;
        }
        unsubscribe();
      };
    },
  };
}

function recordingSink(): StreamSink & { frames: PersistedEvent[]; ended: number } {
  const sink = {
    frames: [] as PersistedEvent[],
    ended: 0,
    write(event: PersistedEvent) {
      sink.frames.push(event);
    },
    end() {
      sink.ended += 1;
    },
  };
  return sink;
}

const deltaText = (frames: readonly PersistedEvent[]): string =>
  frames.flatMap((e) => (e.type === "response.delta" ? [e.data.text] : [])).join("");

async function completedResponse(c: Container): Promise<ResponseId> {
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "one two three four five six seven" });
  await settle(c);
  expect(c.responses.findById(accepted.response.id)?.status).toBe("completed"); // fixture check
  return accepted.response.id;
}

describe("AC-011 replay/live handoff", () => {
  it("reconnect at mid-stream replays only later events, concatenated deltas contain no repeat, then continues live", async () => {
    const gated = gatedProvider(2); // two deltas persisted, then paused mid-stream
    const c = container(gated.provider);
    const hub = countingHub(c.hub);
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const responseId = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "one two three four five six seven" }).response.id;
    await gated.reached;
    expect(c.events.maxSeq(responseId)).toBe(3); // fixture: started@1, delta@2, delta@3

    // First connection: replay everything so far, then the client drops after it has seen seq 2.
    const first = recordingSink();
    const detachFirst = attachResponseStream({ hub, events: c.events }, responseId, 0, first);
    cleanups.push(detachFirst);
    expect(first.frames.map((e) => e.seq)).toEqual([1, 2, 3]);
    detachFirst();
    const seenBeforeDrop = first.frames.filter((e) => e.seq <= 2);

    // Reconnect with Last-Event-ID = 2: replay seq 3 only, then live.
    const second = recordingSink();
    cleanups.push(attachResponseStream({ hub, events: c.events }, responseId, 2, second));
    expect(second.frames.map((e) => e.seq)).toEqual([3]); // replayed, nothing ≤ 2
    expect(second.ended).toBe(0);

    gated.release();
    await settle(c);
    const seqs = second.frames.map((e) => e.seq);
    expect(seqs).toEqual([3, 4, 5]); // replay, then live delta@4 and completed@5
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(second.frames.at(-1)?.type).toBe("response.completed");
    expect(second.ended).toBe(1);
    expect(hub.active()).toBe(0); // ending after the terminal frame unsubscribed

    // What the client saw before the drop + after the reconnect is exactly the full text, once.
    expect(deltaText([...seenBeforeDrop, ...second.frames])).toBe(FULL_TEXT);
    expect(deltaText(c.events.listAfter(responseId, 0))).toBe(FULL_TEXT);
  });

  it("on an ACTIVE stream, events buffered during the synchronous backfill are de-duplicated by seq, then live delivery continues (the STREAM-INV-1 safety net)", async () => {
    const gated = gatedProvider(2); // started@1, delta@2, delta@3 persisted; paused, not terminal
    const c = container(gated.provider);
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const responseId = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "x" }).response.id;
    await gated.reached;
    const stored = c.events.listAfter(responseId, 0);
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3]); // fixture: non-terminal backlog
    // Force the invariant break: live publications of seq 2 and 3 (overlapping the backlog) land
    // during the synchronous backfill, so they sit in the buffer when it is flushed.
    const events: EventRepo = {
      ...c.events,
      listAfter: (id, after) => {
        c.hub.publish(stored[1] as PersistedEvent);
        c.hub.publish(stored[2] as PersistedEvent);
        return c.events.listAfter(id, after);
      },
    };
    const sink = recordingSink();
    cleanups.push(attachResponseStream({ hub: c.hub, events }, responseId, 0, sink));
    expect(sink.frames.map((e) => e.seq)).toEqual([1, 2, 3]); // buffered duplicates dropped
    expect(sink.ended).toBe(0); // still live: the guard, not an early end, removed them

    gated.release();
    await settle(c);
    expect(sink.frames.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(sink.frames.at(-1)?.type).toBe("response.completed");
    expect(deltaText(sink.frames)).toBe(FULL_TEXT); // each delta exactly once
    expect(sink.ended).toBe(1);
  });
});

describe("terminal responses", () => {
  it("reconnect on a terminal response replays then closes", async () => {
    const c = container();
    const hub = countingHub(c.hub);
    const responseId = await completedResponse(c);
    const maxSeq = c.events.maxSeq(responseId);

    const all = recordingSink();
    attachResponseStream({ hub, events: c.events }, responseId, 0, all);
    expect(all.frames.map((e) => e.seq)).toEqual(Array.from({ length: maxSeq }, (_, i) => i + 1));
    expect(all.ended).toBe(1);

    const tail = recordingSink();
    attachResponseStream({ hub, events: c.events }, responseId, 2, tail);
    expect(tail.frames.map((e) => e.seq)).toEqual(Array.from({ length: maxSeq - 2 }, (_, i) => i + 3));
    expect(tail.frames.at(-1)?.type).toBe("response.completed");
    expect(tail.ended).toBe(1);
    expect(hub.active()).toBe(0);
  });

  it("Last-Event-ID === maxSeq on a terminal response closes with zero frames", async () => {
    const c = container();
    const hub = countingHub(c.hub);
    const responseId = await completedResponse(c);
    const sink = recordingSink();
    attachResponseStream({ hub, events: c.events }, responseId, c.events.maxSeq(responseId), sink);
    expect(sink.frames).toEqual([]);
    expect(sink.ended).toBe(1);
    expect(hub.active()).toBe(0);
  });
});

describe("subscriber cleanup", () => {
  it("synchronous backfill/read or sink/write failure detaches the buffering subscriber before rethrow", async () => {
    const c = container();
    const responseId = await completedResponse(c);
    const stored = c.events.listAfter(responseId, 0);

    // (a) The synchronous read fails.
    const readHub = countingHub(c.hub);
    const readFailure = new Error("database read failed");
    const failingEvents: EventRepo = { ...c.events, listAfter: () => { throw readFailure; } };
    const readSink = recordingSink();
    expect(() => attachResponseStream({ hub: readHub, events: failingEvents }, responseId, 0, readSink)).toThrow(readFailure);
    expect(readHub.active()).toBe(0);
    c.hub.publish(stored[1] as PersistedEvent); // nothing may still be listening
    expect(readSink.frames).toEqual([]);
    expect(readSink.ended).toBe(0);

    // (b) The sink write fails during the backlog.
    const writeHub = countingHub(c.hub);
    const writeFailure = new Error("socket write failed");
    let writes = 0;
    const failingSink: StreamSink = {
      write: () => {
        writes += 1;
        if (writes === 2) throw writeFailure;
      },
      end: () => {},
    };
    expect(() => attachResponseStream({ hub: writeHub, events: c.events }, responseId, 0, failingSink)).toThrow(writeFailure);
    expect(writeHub.active()).toBe(0);
    c.hub.publish(stored[1] as PersistedEvent);
    expect(writes).toBe(2);

    // (c) The terminal check (a read in step 5) fails.
    const terminalHub = countingHub(c.hub);
    const terminalFailure = new Error("terminal read failed");
    const failingTerminal: EventRepo = { ...c.events, listAfter: () => [], hasTerminal: () => { throw terminalFailure; } };
    expect(() => attachResponseStream({ hub: terminalHub, events: failingTerminal }, responseId, c.events.maxSeq(responseId), recordingSink())).toThrow(terminalFailure);
    expect(terminalHub.active()).toBe(0);
  });

  it("a sink write failure on a live event drops that subscriber at the hub; the runner is unaffected", async () => {
    const gated = gatedProvider(1);
    const c = container(gated.provider);
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const responseId = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "x" }).response.id;
    await gated.reached;
    let writes = 0;
    const brokenLive: StreamSink = {
      write: (event) => {
        writes += 1;
        if (event.seq > 2) throw new Error("socket gone");
      },
      end: () => {},
    };
    cleanups.push(attachResponseStream({ hub: c.hub, events: c.events }, responseId, 0, brokenLive));
    const replayed = writes;
    gated.release();
    await settle(c);
    expect(writes).toBe(replayed + 1); // one failed live write, then dropped
    expect(c.responses.findById(responseId)?.status).toBe("completed");
  });

  it("detach stops delivery without ending the sink; hub.closeAll ends it without a frame", async () => {
    const gated = gatedProvider(1);
    const c = container(gated.provider);
    const hub = countingHub(c.hub);
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const responseId = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "x" }).response.id;
    await gated.reached;

    const detached = recordingSink();
    const detach = attachResponseStream({ hub, events: c.events }, responseId, 0, detached);
    const closed = recordingSink();
    cleanups.push(attachResponseStream({ hub, events: c.events }, responseId, 0, closed));
    const replayedCount = detached.frames.length;
    detach();
    detach();
    expect(hub.active()).toBe(1);

    c.hub.closeAll();
    expect(closed.ended).toBe(1);
    expect(closed.frames).toHaveLength(replayedCount); // no frame written on close
    gated.release();
    await settle(c);
    expect(detached.frames).toHaveLength(replayedCount);
    expect(detached.ended).toBe(0);
  });
});

describe("response isolation (FR-005)", () => {
  it("live: an attachment to response A receives none of response B's concurrent events", async () => {
    const gatedA = gatedProvider(1);
    const gatedB = gatedProvider(1);
    let runs = 0;
    const c = container({
      stream: (input) => {
        runs += 1;
        return (runs === 1 ? gatedA : gatedB).provider.stream(input);
      },
    });
    const a = c.serverDeps.sendMessage({ conversationId: c.serverDeps.createConversation().conversation.id, clientMessageId: "k-a", content: "x" }).response.id;
    const b = c.serverDeps.sendMessage({ conversationId: c.serverDeps.createConversation().conversation.id, clientMessageId: "k-b", content: "x" }).response.id;
    await Promise.all([gatedA.reached, gatedB.reached]);
    const sinkA = recordingSink();
    cleanups.push(attachResponseStream({ hub: c.hub, events: c.events }, a, 0, sinkA));
    gatedB.release();
    gatedA.release();
    await settle(c);
    expect(sinkA.frames.length).toBeGreaterThan(0);
    for (const frame of sinkA.frames) {
      expect(frame.responseId).toBe(a);
      expect(frame.data.responseId).toBe(a);
    }
    expect(c.events.listAfter(b, 0).length).toBeGreaterThan(0); // B really did stream meanwhile
    expect(sinkA.ended).toBe(1);
  });
});
