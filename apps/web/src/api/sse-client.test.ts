/**
 * SPECS §6.1, §6.5, §9.2 (FR-005, FR-007, AC-004, AC-011, AC-012, AC-018).
 * fetch is stubbed with controllable ReadableStream bodies — no network, no
 * native SSE object. Contract under test: Last-Event-ID header, framing on
 * \n\n, comment lines ignored, schema validation before delivery, envelope
 * mapping for non-2xx, and exactly one final callback per stream.
 *
 * Explicit exclusion: a consumer callback that THROWS (e.g. onEvent) is not
 * covered here. That path deliberately stops the stream and rethrows to the
 * caller, which Vitest reports as an unhandled error; it was exercised by the
 * INC-08 live validation instead. Callback-error coverage is therefore not
 * claimed to be complete at this layer.
 */
import type { ResponseId } from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiError } from "../state/ui-status";
import { openResponseStream } from "./sse-client";

const BASE = "http://api.test:8787";
const R = "33333333-3333-4333-8333-333333333333" as ResponseId;
const OTHER = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const T = "2026-09-27T10:00:00.000Z";

const frame = (id: number, event: string, data: unknown): string => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const started = frame(1, "response.started", { responseId: R, conversationId: C, seq: 1 });
const delta = (seq: number, text: string): string => frame(seq, "response.delta", { responseId: R, seq, text });
const completed = (seq: number, content: string): string =>
  frame(seq, "response.completed", {
    responseId: R,
    seq,
    assistantMessage: { id: M, conversationId: C, seq: 2, role: "assistant", content, clientMessageId: null, createdAt: T },
  });
const failed = (seq: number): string =>
  frame(seq, "response.failed", { responseId: R, seq, failure: { code: "PROVIDER_DISCONNECTED", message: "The assistant connection was lost." } });

/** A body whose chunks are released on demand; `end()` closes it; aborting the request errors it. */
function controllableBody(signal: AbortSignal | null | undefined) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  signal?.addEventListener("abort", () => {
    try { controller.error(new DOMException("The operation was aborted.", "AbortError")); } catch { /* already closed */ }
  });
  const encoder = new TextEncoder();
  return {
    stream,
    push: (chunk: string | Uint8Array) => controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk),
    end: () => controller.close(),
  };
}

type Body = ReturnType<typeof controllableBody>;

function stubFetch(respond: (body: Body) => Promise<Response> | Response) {
  const bodies: Body[] = [];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const body = controllableBody(init?.signal);
    bodies.push(body);
    return Promise.resolve(respond(body));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

const sseResponse = (body: Body): Response => new Response(body.stream, { status: 200, headers: { "content-type": "text/event-stream" } });

interface Recording {
  events: { type: string; seq: number; text?: string }[];
  errors: UiError[];
  closed: string[];
  finals: number;
  done: Promise<void>;
}

function open(lastEventId = 0, signal: AbortSignal = new AbortController().signal) {
  let resolveDone!: () => void;
  const recording: Recording = {
    events: [], errors: [], closed: [], finals: 0, done: new Promise((r) => { resolveDone = r; }),
  };
  const handle = openResponseStream(BASE, R, lastEventId, {
    onEvent: (event) => {
      recording.events.push({ type: event.type, seq: event.data.seq, ...(event.type === "response.delta" ? { text: event.data.text } : {}) });
    },
    onError: (error) => { recording.errors.push(error); recording.finals++; resolveDone(); },
    onClosed: (reason) => { recording.closed.push(reason); recording.finals++; resolveDone(); },
  }, signal);
  return { recording, handle };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request contract (§6.5)", () => {
  it("GETs /api/responses/:id/events with last-event-id = String(lastEventId)", async () => {
    const { fetchMock, bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open(7);
    await tick();
    bodies[0]?.end();
    await recording.done;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/api/responses/${R}/events`);
    expect(new Headers(init?.headers).get("last-event-id")).toBe("7");
  });

  it("sends last-event-id: 0 for a fresh replay", async () => {
    const { fetchMock, bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open(0);
    await tick();
    bodies[0]?.end();
    await recording.done;
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("last-event-id")).toBe("0");
  });
});

describe("framing and delivery", () => {
  it("delivers events in order, then exactly one onClosed('terminal') when the body ends after a terminal event", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    const body = bodies[0];
    body?.push(started + delta(2, "Mock reply: ") + delta(3, "hi") + completed(4, "Mock reply: hi"));
    body?.end();
    await recording.done;
    await tick();
    expect(recording.events).toEqual([
      { type: "response.started", seq: 1 },
      { type: "response.delta", seq: 2, text: "Mock reply: " },
      { type: "response.delta", seq: 3, text: "hi" },
      { type: "response.completed", seq: 4 },
    ]);
    expect(recording.closed).toEqual(["terminal"]);
    expect(recording.errors).toEqual([]);
    expect(recording.finals).toBe(1);
  });

  it("a failed terminal event also closes as 'terminal'", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    bodies[0]?.push(started + failed(2));
    bodies[0]?.end();
    await recording.done;
    expect(recording.events.map((e) => e.type)).toEqual(["response.started", "response.failed"]);
    expect(recording.closed).toEqual(["terminal"]);
  });

  it("reassembles frames delivered one byte per chunk, so every multi-byte UTF-8 sequence is split", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    const body = bodies[0];
    const text = "héllo 😀 世界"; // é = 2 bytes, 😀 = 4 bytes, 世/界 = 3 bytes each
    const bytes = new TextEncoder().encode(started + delta(2, text));
    // The fixture really contains multi-byte sequences: more bytes than UTF-16 units in the text.
    expect(new TextEncoder().encode(text).length).toBe(18); // 1+2+1+1+1+1+4+1+3+3
    expect(text.length).toBe(11);
    for (const byte of bytes) {
      body?.push(Uint8Array.of(byte));
    }
    body?.end();
    await recording.done;
    expect(recording.events).toEqual([
      { type: "response.started", seq: 1 },
      { type: "response.delta", seq: 2, text: "héllo 😀 世界" },
    ]);
  });

  it("ignores heartbeat comment frames and comment lines inside a frame", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    bodies[0]?.push(": ping\n\n" + started + ": ping\n\n" + `: note\n${delta(2, "x")}`);
    bodies[0]?.end();
    await recording.done;
    expect(recording.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(recording.errors).toEqual([]);
  });

  it("an unterminated trailing frame is never delivered; the body ending without a terminal event ⇒ 'network'", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    bodies[0]?.push(started + delta(2, "partial").slice(0, -2)); // second frame lacks its blank line
    bodies[0]?.end();
    await recording.done;
    expect(recording.events.map((e) => e.seq)).toEqual([1]);
    expect(recording.closed).toEqual(["network"]);
    expect(recording.finals).toBe(1);
  });
});

describe("invalid payloads never reach onEvent (AC-004)", () => {
  const invalidFrames: ReadonlyArray<readonly [string, string]> = [
    ["an unknown field (strict schema)", frame(2, "response.delta", { responseId: R, seq: 2, text: "x", extra: true })],
    ["an unknown event type", frame(2, "response.cancelled", { responseId: R, seq: 2 })],
    ["data that is not JSON", "id: 2\nevent: response.delta\ndata: {not json\n\n"],
    ["id that differs from data.seq", frame(9, "response.delta", { responseId: R, seq: 2, text: "x" })],
    ["another response's id", frame(2, "response.delta", { responseId: OTHER, seq: 2, text: "x" })],
    ["a frame with no data line", "id: 2\nevent: response.delta\n\n"],
    ["a payload of another type's shape", frame(2, "response.delta", { responseId: R, conversationId: C, seq: 2 })],
  ];

  it.each(invalidFrames)("%s ⇒ onError(server, INVALID_EVENT), later frames dropped, no onClosed", async (_label, bad) => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording } = open();
    await tick();
    bodies[0]?.push(started + bad + delta(3, "never"));
    await recording.done;
    await tick();
    expect(recording.events.map((e) => e.seq)).toEqual([1]);
    expect(recording.errors).toEqual([
      { kind: "server", code: "INVALID_EVENT", message: "The server sent an invalid stream event.", nextAction: "reload" },
    ]);
    expect(recording.closed).toEqual([]);
    expect(recording.finals).toBe(1);
  });
});

describe("non-2xx replies are mapped per §9.2 and end the stream through onError only", () => {
  const envelope = (code: string, message: string): string => JSON.stringify({ error: { code, message, requestId: "req-1" } });

  it.each([
    [400, envelope("LAST_EVENT_ID_OUT_OF_RANGE", "Last-Event-ID is beyond the last event of this response."), { kind: "validation", code: "LAST_EVENT_ID_OUT_OF_RANGE", nextAction: "fix-input" }],
    [400, envelope("INVALID_LAST_EVENT_ID", "Last-Event-ID must be a non-negative integer."), { kind: "validation", code: "INVALID_LAST_EVENT_ID", nextAction: "fix-input" }],
    [404, envelope("NOT_FOUND", "Response not found."), { kind: "server", code: "NOT_FOUND", nextAction: "reload" }],
    [503, envelope("SERVICE_UNAVAILABLE", "The server is shutting down."), { kind: "server", code: "SERVICE_UNAVAILABLE", nextAction: "reload" }],
    [502, "<html>Bad gateway</html>", { kind: "server", code: "INVALID_RESPONSE", nextAction: "reload" }],
    [400, JSON.stringify({ error: { code: "TEAPOT", message: "x", requestId: "r" } }), { kind: "server", code: "INVALID_RESPONSE", nextAction: "reload" }],
  ] as const)("%d %s", async (status, text, expected) => {
    stubFetch(() => new Response(text, { status, headers: { "content-type": "application/json" } }));
    const { recording } = open(999);
    await recording.done;
    await tick();
    expect(recording.errors).toHaveLength(1);
    expect(recording.errors[0]).toMatchObject(expected);
    expect(recording.closed).toEqual([]);
    expect(recording.events).toEqual([]);
  });
});

describe("network failure and abort", () => {
  it("a non-abort read failure mid-body, after a valid delta ⇒ the delta is kept, then exactly one onClosed('network')", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(stream, { status: 200 }))));
    const { recording } = open();
    await tick();
    controller.enqueue(new TextEncoder().encode(started + delta(2, "Mock ")));
    await tick();
    controller.error(new TypeError("network connection lost")); // not an abort
    await recording.done;
    await tick();
    expect(recording.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(recording.closed).toEqual(["network"]);
    expect(recording.errors).toEqual([]);
    expect(recording.finals).toBe(1);
  });

  it("a 200 response with a null body ⇒ exactly one onClosed('network'), no events, no error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    const { recording } = open();
    await recording.done;
    await tick();
    expect(recording.events).toEqual([]);
    expect(recording.errors).toEqual([]);
    expect(recording.closed).toEqual(["network"]);
    expect(recording.finals).toBe(1);
  });

  it("fetch rejecting ⇒ exactly one onClosed('network')", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const { recording } = open();
    await recording.done;
    await tick();
    expect(recording.closed).toEqual(["network"]);
    expect(recording.finals).toBe(1);
  });

  it("close() ⇒ exactly one onClosed('aborted'), and nothing is delivered afterwards", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const { recording, handle } = open();
    await tick();
    bodies[0]?.push(started);
    await tick();
    handle.close();
    handle.close();
    await recording.done;
    await tick();
    expect(recording.events.map((e) => e.seq)).toEqual([1]);
    expect(recording.closed).toEqual(["aborted"]);
    expect(recording.finals).toBe(1);
  });

  it("the caller's signal aborting mid-stream ⇒ one onClosed('aborted')", async () => {
    const { bodies } = stubFetch((b) => sseResponse(b));
    const caller = new AbortController();
    const { recording } = open(0, caller.signal);
    await tick();
    bodies[0]?.push(started);
    await tick();
    caller.abort();
    await recording.done;
    await tick();
    expect(recording.closed).toEqual(["aborted"]);
    expect(recording.finals).toBe(1);
  });

  it("an already-aborted caller signal ⇒ one onClosed('aborted'), no events", async () => {
    stubFetch((b) => sseResponse(b));
    const caller = new AbortController();
    caller.abort();
    const { recording } = open(0, caller.signal);
    await recording.done;
    await tick();
    expect(recording.closed).toEqual(["aborted"]);
    expect(recording.events).toEqual([]);
    expect(recording.finals).toBe(1);
  });
});
