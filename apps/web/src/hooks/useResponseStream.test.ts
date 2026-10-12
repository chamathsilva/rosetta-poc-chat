/**
 * SPECS §6.5, §9.4 rules 6–7 (FR-005, FR-007, AC-011, AC-013). The hook keeps
 * one stream per streamable response; a `network` close reconnects from
 * lastAppliedEventId after [250, 500, 1000, 2000, 4000] ms (capped at 4000), at
 * most 6 attempts, then surfaces a network error with action `reload`. It is
 * cancelled by a selection change and by unmount. fetch is stubbed (no network,
 * no native SSE object); only setTimeout/clearTimeout are faked.
 */
import {
  conversationIdSchema,
  conversationSchema,
  messageIdSchema,
  messageSchema,
  responseIdSchema,
  responseSchema,
  type Response as WireResponse,
} from "@rosetta-poc/chat-shared";
import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatReducer, initialChatState, type ChatAction, type ChatState } from "../state/chat-reducer";
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_BACKOFF_MS, useResponseStream } from "./useResponseStream";

const BASE = "http://api.test";
const T = "2026-09-28T10:00:00.000Z";
const C = conversationIdSchema.parse("11111111-1111-4111-8111-111111111111");
const C2 = conversationIdSchema.parse("11111111-1111-4111-8111-222222222222");
const U = messageIdSchema.parse("22222222-2222-4222-8222-000000000001");
const R = responseIdSchema.parse("33333333-3333-4333-8333-000000000001");

const conversation = conversationSchema.parse({ id: C, title: "t", createdAt: T, updatedAt: T });
const userMessage = messageSchema.parse({ id: U, conversationId: C, seq: 1, role: "user", content: "hi", clientMessageId: "k", createdAt: T });
const wire = (status: WireResponse["status"]): WireResponse =>
  responseSchema.parse({
    id: R, conversationId: C, userMessageId: U, assistantMessageId: null, status, partialText: "",
    failure: status === "failed" ? { code: "PROVIDER_ERROR", message: "x" } : null,
    retryOfResponseId: null, retriedByResponseId: null, createdAt: T, updatedAt: T,
  });

const frame = (seq: number, type: string, data: object): string => `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const started = frame(1, "response.started", { responseId: R, conversationId: C, seq: 1 });
const delta = (seq: number, text: string): string => frame(seq, "response.delta", { responseId: R, seq, text });

// ---- stubbed fetch: every events request is recorded and answered by a scripted behavior
type Behavior = { kind: "network" } | { kind: "stream" } | { kind: "status"; status: number; body: string };
interface Call {
  readonly url: string;
  readonly lastEventId: string | null;
  readonly signal: AbortSignal | null;
  push(chunk: string): void;
  end(): void;
  drop(): void;
}
const calls: Call[] = [];
let behaviors: Behavior[] = [];

function installFetch(): void {
  behaviors = [];
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const behavior = behaviors.shift() ?? { kind: "stream" };
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    const signal = init?.signal ?? null;
    let closed = false;
    const encoder = new TextEncoder();
    const call: Call = {
      url,
      lastEventId: new Headers(init?.headers).get("last-event-id"),
      signal,
      push: (chunk) => { if (!closed) controller.enqueue(encoder.encode(chunk)); },
      end: () => { if (!closed) { closed = true; controller.close(); } },
      drop: () => { if (!closed) { closed = true; controller.error(new TypeError("network connection lost")); } },
    };
    signal?.addEventListener("abort", () => call.drop());
    calls.push(call);
    if (behavior.kind === "network") return Promise.reject(new TypeError("Failed to fetch"));
    if (behavior.kind === "status") return Promise.resolve(new Response(behavior.body, { status: behavior.status, headers: { "content-type": "application/json" } }));
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(responseStatus: WireResponse["status"] = "streaming") {
  installFetch();
  const hook = renderHook(() => {
    const [state, dispatch] = useReducer(chatReducer, initialChatState);
    useResponseStream(BASE, state, dispatch);
    return { state, dispatch };
  });
  const dispatch = (action: ChatAction): void => {
    act(() => hook.result.current.dispatch(action));
  };
  dispatch({ type: "conversation/selected", conversationId: C });
  dispatch({ type: "conversation/loaded", detail: { conversation, messages: [userMessage], responses: [wire(responseStatus)], activeResponse: null } });
  const state = (): ChatState => hook.result.current.state;
  return { hook, dispatch, state };
}

/** Flush pending promise jobs (fetch resolution, stream reads) inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

describe("stream lifecycle", () => {
  it("an active response opens exactly one stream from lastAppliedEventId 0; a terminal close does not reconnect", async () => {
    const { state } = setup();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/responses/${R}/events`);
    expect(calls[0]?.lastEventId).toBe("0");
    calls[0]?.push(started + delta(2, "Mock ") + frame(3, "response.failed", { responseId: R, seq: 3, failure: { code: "PROVIDER_ERROR", message: "x" } }));
    calls[0]?.end();
    await flush();
    expect(state().responses[R]).toMatchObject({ status: "failed", text: "Mock ", lastAppliedEventId: 3, streamClosed: true });
    expect(calls).toHaveLength(1);
  });

  it.each(["completed", "failed"] as const)("a %s (terminal) response never opens a stream", async (status) => {
    setup(status);
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("an HTTP error ends the stream through stream/error with no reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    installFetch();
    behaviors = [{ kind: "status", status: 404, body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Response not found.", requestId: "r" } }) }];
    const { state } = (() => {
      const hook = renderHook(() => {
        const [s, d] = useReducer(chatReducer, initialChatState);
        useResponseStream(BASE, s, d);
        return { s, d };
      });
      act(() => hook.result.current.d({ type: "conversation/selected", conversationId: C }));
      act(() => hook.result.current.d({ type: "conversation/loaded", detail: { conversation, messages: [userMessage], responses: [wire("streaming")], activeResponse: null } }));
      return { state: () => hook.result.current.s };
    })();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(calls).toHaveLength(1);
    expect(state().lastError).toMatchObject({ kind: "server", code: "NOT_FOUND", nextAction: "reload" });
    expect(state().responses[R]?.streamClosed).toBe(true);
  });
});

describe("§6.5 reconnect policy", () => {
  it("the policy constants are the specified ones", () => {
    expect(RECONNECT_BACKOFF_MS).toEqual([250, 500, 1000, 2000, 4000]);
    expect(MAX_RECONNECT_ATTEMPTS).toBe(6);
  });

  it("network closes reconnect after 250, 500, 1000, 2000, 4000, 4000 ms (6 attempts), then surface a network error with action reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { state } = setup();
    behaviors = Array.from({ length: 6 }, () => ({ kind: "network" as const }));
    await flush();
    expect(calls).toHaveLength(1);
    calls[0]?.drop(); // the first connection drops: a network close
    await flush();

    for (const [attempt, wait] of [250, 500, 1000, 2000, 4000, 4000].entries()) {
      expect(state().responses[R]).toMatchObject({ status: "reconnecting", reconnectAttempt: attempt + 1 });
      await act(async () => { await vi.advanceTimersByTimeAsync(wait - 1); });
      expect(calls, `no reconnect before ${wait} ms (attempt ${attempt + 1})`).toHaveLength(attempt + 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await flush();
      expect(calls, `reconnect at ${wait} ms (attempt ${attempt + 1})`).toHaveLength(attempt + 2);
    }

    // The 6th reconnect also failed: no 7th attempt; a network error with action reload instead.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toHaveLength(7);
    expect(state().lastError).toMatchObject({ kind: "network", nextAction: "reload" });
    expect(state().responses[R]?.streamClosed).toBe(true);
  });

  it("each reconnect resumes from lastAppliedEventId; a successful event resets the attempt count", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { state } = setup();
    await flush();
    calls[0]?.push(started + delta(2, "Mock "));
    await flush();
    calls[0]?.drop();
    await flush();
    expect(state().responses[R]?.reconnectAttempt).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.lastEventId).toBe("2");
    calls[1]?.push(delta(2, "Mock ") + delta(3, "reply")); // seq 2 replayed (ignored), seq 3 new
    await flush();
    expect(state().responses[R]).toMatchObject({ text: "Mock reply", lastAppliedEventId: 3, reconnectAttempt: 0, status: "streaming" });
    // After a reset, the next drop waits the FIRST backoff step again.
    calls[1]?.drop();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(calls).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]?.lastEventId).toBe("3");
  });
});

describe("cancellation", () => {
  it("a selection change aborts the open stream and cancels a pending reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { dispatch } = setup();
    await flush();
    expect(calls[0]?.signal?.aborted).toBe(false);
    calls[0]?.drop();
    await flush(); // a reconnect is now scheduled
    dispatch({ type: "conversation/selected", conversationId: C2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(calls).toHaveLength(1); // the scheduled reconnect never ran
  });

  it("a selection change aborts a live stream's request", async () => {
    const { dispatch } = setup();
    await flush();
    const signal = calls[0]?.signal;
    expect(signal?.aborted).toBe(false);
    dispatch({ type: "conversation/selected", conversationId: C2 });
    await flush();
    expect(signal?.aborted).toBe(true);
  });

  it("unmount cancels a pending reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { hook } = setup();
    await flush();
    calls[0]?.drop(); // the request has ended (network close); a reconnect is scheduled
    await flush();
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(calls).toHaveLength(1); // the scheduled reconnect never ran
  });

  it("unmount aborts a live stream's request", async () => {
    const { hook } = setup();
    await flush();
    const signal = calls[0]?.signal;
    expect(signal?.aborted).toBe(false);
    hook.unmount();
    await flush();
    expect(signal?.aborted).toBe(true);
  });
});
