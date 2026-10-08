/**
 * SPECS §6.1, §6.2, §6.3, §6.4 (FR-004, FR-005, AC-010, AC-011, AC-012). The
 * real GET /api/responses/:responseId/events route over a real container
 * (buildServer). Terminal responses are read whole via inject; the live
 * replay-to-live handoff uses a loopback socket so frames are read as they
 * arrive. Deterministic fixtures: fakeClock + sequentialIds; gated provider.
 */
import type { AddressInfo } from "node:net";
import { errorEnvelopeSchema, streamEventSchema, type ResponseId } from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import type { Provider, ProviderChunk } from "../../ports.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };

// Owned-resource cleanup stack: runs in reverse even when a test fails.
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function settle(c: Container): Promise<void> {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
}

function setup(provider?: Provider): { c: Container; app: FastifyInstance } {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), ...(provider === undefined ? {} : { provider }) });
  cleanups.push(async () => {
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    closeDatabase(c.db);
  });
  const app = buildServer(c.serverDeps);
  cleanups.push(() => app.close()); // registered after the container, so it closes first
  return { c, app };
}

async function completedResponse(c: Container, content = "one two three four five six seven"): Promise<ResponseId> {
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: `k-${content}`, content });
  await settle(c);
  expect(c.responses.findById(accepted.response.id)?.status).toBe("completed"); // fixture check
  return accepted.response.id;
}

interface Frame {
  readonly id: string | null;
  readonly event: string | null;
  readonly data: string | null;
  readonly comment: boolean;
}

/** Splits a §6.1 body into frames; validates every event frame against the shared schema. */
function parseFrames(body: string): Frame[] {
  const frames = body.split("\n\n").filter((raw) => raw !== "").map((raw): Frame => {
    let id: string | null = null;
    let event: string | null = null;
    let data: string | null = null;
    for (const line of raw.split("\n")) {
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    return { id, event, data, comment: raw.startsWith(":") };
  });
  for (const frame of frames.filter((f) => !f.comment)) {
    const parsed = streamEventSchema.parse({ type: frame.event, data: JSON.parse(frame.data ?? "null") });
    expect(String(parsed.data.seq)).toBe(frame.id);
  }
  return frames;
}

const ids = (body: string): number[] => parseFrames(body).filter((f) => !f.comment).map((f) => Number(f.id));
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function events(app: FastifyInstance, responseId: string, lastEventId?: string) {
  return app.inject({
    method: "GET",
    url: `/api/responses/${responseId}/events`,
    ...(lastEventId === undefined ? {} : { headers: { "last-event-id": lastEventId } }),
  });
}

describe("AC-012 — the five §6.3 rows over the real route", () => {
  it("row 1: header absent ⇒ 200 text/event-stream, full replay, then the stream closes", async () => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    const maxSeq = c.events.maxSeq(responseId);
    const reply = await events(app, responseId);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(ids(reply.body)).toEqual(range(1, maxSeq));
  });

  it.each(["", "   ", "\t"])("row 2: header %j (empty or whitespace-only ≡ absent) ⇒ 200, full replay", async (header) => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    const reply = await events(app, responseId, header);
    expect(reply.statusCode).toBe(200);
    expect(ids(reply.body)).toEqual(range(1, c.events.maxSeq(responseId)));
  });

  it.each(["abc", "-1", "1.5", "1e3", "1234567890123456", "+1"])(
    "row 3: %j (not ^\\d{1,15}$ after trim) ⇒ 400 INVALID_LAST_EVENT_ID as a JSON envelope, before any SSE header",
    async (header) => {
      const { c, app } = setup();
      const responseId = await completedResponse(c);
      const reply = await events(app, responseId, header);
      expect(reply.statusCode).toBe(400);
      expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe("INVALID_LAST_EVENT_ID");
    },
  );

  it("row 4: digits above maxSeq ⇒ 400 LAST_EVENT_ID_OUT_OF_RANGE as a JSON envelope", async () => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    for (const header of [String(c.events.maxSeq(responseId) + 1), "999"]) {
      const reply = await events(app, responseId, header);
      expect(reply.statusCode).toBe(400);
      expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe("LAST_EVENT_ID_OUT_OF_RANGE");
    }
  });

  it("row 5: digits 0 ≤ value ≤ maxSeq ⇒ 200, replay of seq > value only (leading zeros decimal)", async () => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    const maxSeq = c.events.maxSeq(responseId);
    expect(maxSeq).toBeGreaterThanOrEqual(4); // fixture: enough events to replay a strict suffix
    for (const [header, from] of [["0", 1], ["2", 3], ["002", 3], [` ${maxSeq - 1} `, maxSeq]] as const) {
      const reply = await events(app, responseId, header);
      expect(reply.statusCode).toBe(200);
      expect(ids(reply.body)).toEqual(range(from, maxSeq));
    }
  });
});

describe("terminal responses and errors", () => {
  it("Last-Event-ID === maxSeq on a terminal response closes with zero frames", async () => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    const reply = await events(app, responseId, String(c.events.maxSeq(responseId)));
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(reply.body).toBe("");
  });

  it("every frame is exactly id/event/one data line; seq 1..n, one start, one terminal, nothing after it (AC-010)", async () => {
    const { c, app } = setup();
    const responseId = await completedResponse(c);
    const reply = await events(app, responseId);
    for (const raw of reply.body.split("\n\n").filter((r) => r !== "")) {
      expect(raw.split("\n").map((line) => line.split(":")[0])).toEqual(["id", "event", "data"]);
    }
    const frames = parseFrames(reply.body);
    expect(frames.filter((f) => f.event === "response.started")).toHaveLength(1);
    expect(frames.filter((f) => f.event === "response.completed" || f.event === "response.failed")).toHaveLength(1);
    expect(frames.at(-1)?.event).toBe("response.completed");
  });

  it.each([
    ["an unknown response", "00000000-0000-4000-8000-00000000ffff", 404, "NOT_FOUND"],
    ["a non-UUID response id", "not-a-uuid", 400, "VALIDATION_FAILED"],
  ] as const)("%s ⇒ %i %s as a JSON envelope", async (_label, id, status, code) => {
    const { app } = setup();
    const reply = await events(app, id);
    expect(reply.statusCode).toBe(status);
    expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe(code);
  });
});

describe("FR-005", () => {
  it("a stream for response A never yields a frame for response B", async () => {
    const { c, app } = setup();
    const a = await completedResponse(c, "alpha content for A");
    const b = await completedResponse(c, "beta content for B");
    for (const [mine, other] of [[a, b], [b, a]] as const) {
      const frames = parseFrames((await events(app, mine)).body).filter((f) => !f.comment);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(JSON.parse(frame.data ?? "{}").responseId).toBe(mine);
        expect(frame.data).not.toContain(other);
      }
    }
  });
});

describe("AC-011 over the real route", () => {
  it("reconnect at mid-stream replays only later events, then continues live to the terminal frame (loopback socket)", async () => {
    // Two deltas persist, then the provider pauses until released.
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    cleanups.push(() => release());
    const chunks = ["Mock reply: one ", "two three four ", "five six seven"];
    const { c, app } = setup({
      async *stream(): AsyncGenerator<ProviderChunk> {
        for (const [index, text] of chunks.entries()) {
          if (index === 2) {
            signal();
            await gate;
          }
          yield { kind: "delta", text };
        }
        yield { kind: "end" };
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const responseId = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "x" }).response.id;
    await reached;
    expect(c.events.maxSeq(responseId)).toBe(3); // fixture: started@1, delta@2, delta@3

    // The client has applied seq 2 and reconnects with Last-Event-ID: 2.
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    const reply = await fetch(`http://127.0.0.1:${port}/api/responses/${responseId}/events`, {
      headers: { "last-event-id": "2" },
      signal: abort.signal,
    });
    expect(reply.status).toBe(200);
    const reader = reply.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    const decoder = new TextDecoder();
    let body = "";
    // Read until the replayed frame (seq 3) has arrived, then release the provider for the live part.
    while (!body.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    expect(ids(body)).toEqual([3]);
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();

    const seqs = ids(body);
    expect(seqs).toEqual([3, 4, 5]); // replay, then live delta@4 and completed@5; nothing ≤ 2
    expect(new Set(seqs).size).toBe(seqs.length);
    const deltas = parseFrames(body).filter((f) => f.event === "response.delta").map((f) => JSON.parse(f.data ?? "{}").text as string);
    expect(["Mock reply: one ", ...deltas].join("")).toBe(chunks.join("")); // seq 2 (already applied) + the rest, no repeat
    expect(parseFrames(body).at(-1)?.event).toBe("response.completed");
  });
});
