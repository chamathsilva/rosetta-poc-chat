/**
 * SPECS §6.1, §6.4 (FR-004, FR-005, AC-003, AC-010). Frame format, the
 * id-less heartbeat, and the hijacked-reply lifecycle (headers, disconnect,
 * attach failure). openSseStream is driven through a minimal Fastify route on a
 * loopback socket so frames are observed as the client receives them. Only
 * setInterval/clearInterval are faked, for the 15 s heartbeat.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { conversationIdSchema, responseIdSchema, type StreamEvent } from "@rosetta-poc/chat-shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedEvent } from "../domain/types.js";
import type { StreamSink } from "../stream/subscribe.js";
import { SSE_HEADERS, SSE_HEARTBEAT_FRAME, SSE_HEARTBEAT_MS, formatSseEvent, openSseStream } from "./sse.js";

const R = responseIdSchema.parse("33333333-3333-4333-8333-000000000001");
const C = conversationIdSchema.parse("11111111-1111-4111-8111-111111111111");
const T = "2026-09-28T10:00:00.000Z";

const persisted = (event: StreamEvent): PersistedEvent => ({ ...event, responseId: R, seq: event.data.seq, createdAt: T });
const started = persisted({ type: "response.started", data: { responseId: R, conversationId: C, seq: 1 } });
const delta = persisted({ type: "response.delta", data: { responseId: R, seq: 2, text: 'line one\nline "two"\\  end' } });

// Owned-resource cleanup stack: runs in reverse even when a test fails.
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Harness {
  readonly app: FastifyInstance;
  readonly url: string;
  sink(): StreamSink;
  readonly detach: ReturnType<typeof vi.fn>;
}

/** A Fastify app whose one route opens an SSE stream and exposes the sink it was given. */
async function harness(options: { attachThrows?: boolean; presetHeader?: boolean } = {}): Promise<Harness> {
  const app = Fastify({ logger: false });
  cleanups.push(() => app.close());
  let captured: StreamSink | null = null;
  const detach = vi.fn();
  app.get("/stream", (_request, reply) => {
    if (options.presetHeader === true) reply.header("access-control-allow-origin", "http://localhost:5173");
    openSseStream(reply, (sink) => {
      if (options.attachThrows === true) throw new Error("attach failed");
      captured = sink;
      return detach;
    });
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    url: `http://127.0.0.1:${port}/stream`,
    sink: () => {
      if (captured === null) throw new Error("not attached");
      return captured;
    },
    detach,
  };
}

function attached(h: Harness): boolean {
  try {
    h.sink();
    return true;
  } catch {
    return false;
  }
}

interface Client {
  readonly chunks: string[];
  headers: http.IncomingHttpHeaders | null;
  status: number | null;
  ended: boolean;
  errored: boolean;
  readonly request: http.ClientRequest;
}

function connect(url: string): Client {
  const client: Client = { chunks: [], headers: null, status: null, ended: false, errored: false, request: http.get(url) };
  client.request.on("response", (res) => {
    client.status = res.statusCode ?? null;
    client.headers = res.headers;
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => client.chunks.push(chunk));
    res.on("end", () => { client.ended = true; });
    res.on("error", () => { client.errored = true; });
    res.on("aborted", () => { client.errored = true; });
  });
  client.request.on("error", () => { client.errored = true; });
  cleanups.push(() => { client.request.destroy(); });
  return client;
}

describe("formatSseEvent (§6.1)", () => {
  it("writes exactly id, event, one compact data line, blank line", () => {
    expect(formatSseEvent(started)).toBe(`id: 1\nevent: response.started\ndata: {"responseId":"${R}","conversationId":"${C}","seq":1}\n\n`);
  });

  it("keeps text with newlines, quotes, backslashes and U+2028 on ONE data line, JSON-escaped and round-trippable", () => {
    const frame = formatSseEvent(delta);
    const lines = frame.split("\n");
    expect(lines).toHaveLength(5); // id, event, data, "", "" — the frame ends with a blank line
    expect(lines[0]).toBe("id: 2");
    expect(lines[1]).toBe("event: response.delta");
    expect(lines[2]?.startsWith("data: ")).toBe(true);
    expect(lines.slice(3)).toEqual(["", ""]);
    expect(JSON.parse((lines[2] ?? "").slice("data: ".length))).toEqual(delta.data);
    expect(lines[2]).not.toContain(" \"");
  });

  it("uses the persisted seq as the id for every event type", () => {
    const failed = persisted({ type: "response.failed", data: { responseId: R, seq: 7, failure: { code: "PROVIDER_ERROR", message: "x" } } });
    expect(formatSseEvent(failed).startsWith("id: 7\nevent: response.failed\n")).toBe(true);
  });

  it("fixed constants: headers, 15 s heartbeat, comment-only heartbeat frame", () => {
    expect(SSE_HEADERS).toEqual({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    expect(SSE_HEARTBEAT_MS).toBe(15000);
    expect(SSE_HEARTBEAT_FRAME).toBe(": ping\n\n");
  });
});

describe("openSseStream lifecycle", () => {
  it("heartbeat frames carry no id:", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    cleanups.push(() => vi.useRealTimers());
    const h = await harness();
    const client = connect(h.url);
    // writeHead only buffers headers; Node sends them with the first body write. The first
    // heartbeat is that write here (no backlog in this harness).
    await waitFor(() => attached(h), "attach");
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    await waitFor(() => client.status !== null, "response headers");
    expect(client.status).toBe(200);
    expect(client.headers?.["content-type"]).toBe("text/event-stream; charset=utf-8");

    h.sink().write(started);
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    h.sink().write(delta);
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    h.sink().end();
    await waitFor(() => client.ended, "stream end");

    const body = client.chunks.join("");
    const frames = body.split("\n\n").filter((frame) => frame !== "");
    const heartbeats = frames.filter((frame) => frame.startsWith(":"));
    expect(heartbeats).toEqual([": ping", ": ping", ": ping"]);
    for (const heartbeat of heartbeats) {
      expect(heartbeat).not.toMatch(/^id:/mu);
      expect(heartbeat).not.toMatch(/^event:/mu);
    }
    // The heartbeats did not perturb the id sequence.
    const ids = frames.filter((frame) => !frame.startsWith(":")).map((frame) => frame.split("\n")[0]);
    expect(ids).toEqual(["id: 1", "id: 2"]);
    expect(body).toBe(`${SSE_HEARTBEAT_FRAME}${formatSseEvent(started)}${SSE_HEARTBEAT_FRAME}${formatSseEvent(delta)}${SSE_HEARTBEAT_FRAME}`);
    expect(vi.getTimerCount()).toBe(0); // end() cleared the heartbeat interval
  });

  it("carries headers already set on the reply (e.g. CORS) onto the hijacked response", async () => {
    const h = await harness({ presetHeader: true });
    const client = connect(h.url);
    await waitFor(() => attached(h), "attach");
    h.sink().write(started); // the first body write sends the buffered headers
    await waitFor(() => client.status !== null, "response headers");
    expect(client.headers?.["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(client.headers?.["cache-control"]).toBe("no-cache, no-transform");
    expect(client.headers?.["x-accel-buffering"]).toBe("no");
    h.sink().end();
    await waitFor(() => client.ended, "stream end");
  });

  it("a client disconnect detaches exactly once and stops the heartbeat; it never ends the sink", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    cleanups.push(() => vi.useRealTimers());
    const h = await harness();
    const client = connect(h.url);
    await waitFor(() => attached(h), "attach");
    h.sink().write(started);
    await waitFor(() => client.status !== null, "response headers");
    expect(vi.getTimerCount()).toBe(1);
    client.request.destroy();
    await waitFor(() => h.detach.mock.calls.length > 0, "detach");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.detach).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => h.sink().write(started)).not.toThrow(); // writes after a disconnect are dropped safely
  });

  it("an attach that throws after the headers were sent drops the connection (no envelope is possible) and clears the heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    cleanups.push(() => vi.useRealTimers());
    const h = await harness({ attachThrows: true });
    const client = connect(h.url);
    await waitFor(() => client.errored || client.ended, "connection drop");
    expect(client.ended && !client.errored).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
