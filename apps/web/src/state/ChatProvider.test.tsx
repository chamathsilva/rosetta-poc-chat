/**
 * SPECS §9.3–§9.5, §6.5 (FR-007, FR-009, AC-008, AC-013) — INC-09 review
 * carry-forwards. Every fetch is stubbed as a deferred the test settles
 * explicitly, so "delayed" means "held until a stated point", never a sleep.
 * A probe component exposes the real provider API.
 */
import {
  conversationIdSchema,
  conversationSchema,
  messageSchema,
  responseIdSchema,
  responseSchema,
  type ConversationId,
  type GetConversationResponse,
  type Message,
  type Response as WireResponse,
} from "@rosetta-poc/chat-shared";
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../components/App";
import { ChatProvider, useChat, type ChatContextValue } from "./ChatProvider";

const BASE = "http://api.test";
const T = "2026-09-28T10:00:00.000Z";
const A = conversationIdSchema.parse("11111111-1111-4111-8111-00000000000a");
const B = conversationIdSchema.parse("11111111-1111-4111-8111-00000000000b");

// ---------------------------------------------------------------- deferred fetch harness

interface PendingCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly signal: AbortSignal | null;
  settled: boolean;
  taken: boolean;
  respond(status: number, body: unknown): void;
  network(): void;
  stream(): { push(chunk: string): void };
}

const calls: PendingCall[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
    new Promise<globalThis.Response>((resolve, reject) => {
      const signal = init?.signal ?? null;
      const call: PendingCall = {
        method: init?.method ?? "GET",
        path: url.slice(BASE.length),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        signal,
        settled: false,
        taken: false,
        respond(status, body) {
          call.settled = true;
          resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
        },
        network() {
          call.settled = true;
          reject(new TypeError("Failed to fetch"));
        },
        stream() {
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          const readable = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
          signal?.addEventListener("abort", () => {
            try { controller.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ }
          });
          call.settled = true;
          resolve(new Response(readable, { status: 200, headers: { "content-type": "text/event-stream" } }));
          return { push: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)) };
        },
      };
      signal?.addEventListener("abort", () => {
        if (!call.settled) {
          call.settled = true;
          reject(new DOMException("aborted", "AbortError"));
        }
      });
      calls.push(call);
    })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** The next not-yet-taken call matching method + path (waits until it is made). */
async function next(method: string, path: string): Promise<PendingCall> {
  let found: PendingCall | undefined;
  await waitFor(() => {
    found = calls.find((c) => !c.taken && c.method === method && c.path === path);
    expect(found, `${method} ${path}`).toBeDefined();
  });
  if (found === undefined) throw new Error("unreachable");
  found.taken = true;
  return found;
}

const count = (method: string, path: string): number => calls.filter((c) => c.method === method && c.path === path).length;

// ---------------------------------------------------------------- fixtures (independent of the code under test)

let idCounter = 0;
const nextId = (): string => `00000000-0000-4000-8000-${(++idCounter).toString(16).padStart(12, "0")}`;

const conversation = (id: ConversationId) => conversationSchema.parse({ id, title: `Conversation ${id.slice(-1)}`, createdAt: T, updatedAt: T });
const userMessage = (conversationId: ConversationId, seq: number, content: string): Message =>
  messageSchema.parse({ id: nextId(), conversationId, seq, role: "user", content, clientMessageId: `k-${seq}`, createdAt: T });
const response = (conversationId: ConversationId, userMessageId: string, status: WireResponse["status"]): WireResponse =>
  responseSchema.parse({
    id: nextId(), conversationId, userMessageId, assistantMessageId: null, status, partialText: "",
    failure: status === "failed" ? { code: "PROVIDER_ERROR", message: "The assistant could not complete this response." } : null,
    retryOfResponseId: null, retriedByResponseId: null, createdAt: T, updatedAt: T,
  });
const detail = (id: ConversationId, messages: Message[] = [], responses: WireResponse[] = []): GetConversationResponse => ({
  conversation: conversation(id),
  messages,
  responses,
  activeResponse: responses.find((r) => r.status === "pending" || r.status === "streaming") ?? null,
});
const accepted = (conversationId: ConversationId, content: string, clientMessageId: string) => {
  const message = messageSchema.parse({ id: nextId(), conversationId, seq: 1, role: "user", content, clientMessageId, createdAt: T });
  return { conversationId, userMessage: message, response: response(conversationId, message.id, "pending") };
};
const envelope = (code: string, message: string) => ({ error: { code, message, requestId: "req-1" } });

// ---------------------------------------------------------------- probe

let ctx: ChatContextValue;
function Probe() {
  ctx = useChat();
  return null;
}

async function mountProvider(): Promise<void> {
  render(
    <ChatProvider baseUrl={BASE}>
      <Probe />
    </ChatProvider>,
  );
  (await next("GET", "/api/conversations")).respond(200, { conversations: [] });
}

async function select(id: ConversationId, data: GetConversationResponse = detail(id)): Promise<void> {
  act(() => ctx.selectConversation(id));
  (await next("GET", `/api/conversations/${id}`)).respond(200, data);
  await waitFor(() => expect(ctx.state.conversationLoad.kind).toBe("ready"));
}

async function settleMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function expectNoErrorShown(): void {
  expect(ctx.state.lastError).toBeNull();
  expect(ctx.state.announcement.politeness).not.toBe("assertive");
}

// ---------------------------------------------------------------- tests

describe("delayed results after a selection change (INC-09 review)", () => {
  it("a delayed send ERROR from A, released after selecting B, never appears in B; B's draft and sending state are unchanged", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.setDraft("hello from A"));
    act(() => ctx.sendDraft());
    const sendA = await next("POST", `/api/conversations/${A}/messages`);
    await select(B);
    act(() => ctx.setDraft("typing in B"));

    sendA.network();
    await settleMicrotasks();

    expect(ctx.state.selectedConversationId).toBe(B);
    expectNoErrorShown();
    expect(ctx.state.draft).toBe("typing in B");
    expect(ctx.state.sending).toBe(false);
    expect(ctx.state.messages).toEqual([]);
    expect(ctx.state.responses).toEqual({});
  });

  it("a delayed send ERROR from A, released while B's own send is pending, leaves B's draft, sending flag, optimistic message and error state unchanged", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.setDraft("hello from A"));
    act(() => ctx.sendDraft());
    const sendA = await next("POST", `/api/conversations/${A}/messages`);
    await select(B);
    act(() => ctx.setDraft("hello from B"));
    act(() => ctx.sendDraft());
    const sendB = await next("POST", `/api/conversations/${B}/messages`); // held: B is mid-send
    const keyB = (sendB.body as { clientMessageId: string }).clientMessageId;
    const before = {
      draft: ctx.state.draft,
      sending: ctx.state.sending,
      messages: ctx.state.messages,
      lastError: ctx.state.lastError,
      announcement: ctx.state.announcement,
    };
    // Fixture check: B really is mid-send with its optimistic message on screen.
    expect(before.sending).toBe(true);
    expect(before.messages.map((m) => [m.content, m.clientMessageId])).toEqual([["hello from B", keyB]]);

    sendA.network();
    await settleMicrotasks();

    expect(ctx.state.selectedConversationId).toBe(B);
    expect(ctx.state.draft).toBe(before.draft);
    expect(ctx.state.sending).toBe(true);
    expect(ctx.state.messages).toEqual(before.messages);
    expect(ctx.state.lastError).toBeNull();
    expect(ctx.state.announcement).toEqual(before.announcement);

    // Release B so teardown never leaves a pending request: B's own result applies normally.
    sendB.respond(202, accepted(B, "hello from B", keyB));
    await waitFor(() => expect(ctx.state.sending).toBe(false));
    expect(ctx.state.messages.map((m) => m.content)).toEqual(["hello from B"]);
  });

  it("a delayed send SUCCESS from A, released after selecting B, adds nothing to B and opens no stream", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.setDraft("hello from A"));
    act(() => ctx.sendDraft());
    const sendA = await next("POST", `/api/conversations/${A}/messages`);
    const body = sendA.body as { clientMessageId: string };
    await select(B);

    const acceptedA = accepted(A, "hello from A", body.clientMessageId);
    sendA.respond(202, acceptedA);
    await settleMicrotasks();

    expect(ctx.state.selectedConversationId).toBe(B);
    expect(ctx.state.messages).toEqual([]);
    expect(ctx.state.responses).toEqual({});
    expect(count("GET", `/api/responses/${acceptedA.response.id}/events`)).toBe(0);
    expectNoErrorShown();
  });

  it("a delayed retry ERROR, released after selecting another conversation, is not shown there", async () => {
    await mountProvider();
    const failedUser = userMessage(A, 1, "please fail");
    const failed = response(A, failedUser.id, "failed");
    await select(A, detail(A, [failedUser], [failed]));
    act(() => ctx.retry(responseIdSchema.parse(failed.id)));
    const retry = await next("POST", `/api/responses/${failed.id}/retry`);
    await select(B);

    retry.respond(409, envelope("RESPONSE_NOT_FAILED", "Only a failed response can be retried."));
    await settleMicrotasks();

    expect(ctx.state.selectedConversationId).toBe(B);
    expectNoErrorShown();
    expect(ctx.state.responses).toEqual({});
  });
});

describe("stale callbacks across A → B → A", () => {
  it("a send started in the first visit to A, released after A → B → A, is dropped", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.setDraft("first visit"));
    act(() => ctx.sendDraft());
    const staleSend = await next("POST", `/api/conversations/${A}/messages`);
    await select(B);
    const kept = userMessage(A, 1, "already stored");
    await select(A, detail(A, [kept]));

    staleSend.network();
    await settleMicrotasks();

    expect(ctx.state.selectedConversationId).toBe(A);
    expectNoErrorShown();
    expect(ctx.state.messages).toEqual([kept]);
    expect(ctx.state.sending).toBe(false);
  });

  it("the first load of A, delivered late after A → B → A, does not overwrite the newer load", async () => {
    await mountProvider();
    act(() => ctx.selectConversation(A));
    const firstLoad = await next("GET", `/api/conversations/${A}`);
    await select(B);
    const m1 = userMessage(A, 1, "one");
    const m2 = userMessage(A, 2, "two");
    await select(A, detail(A, [m1, m2])); // the second, newer load

    firstLoad.respond(200, detail(A, [m1])); // older snapshot, late
    await settleMicrotasks();

    expect(ctx.state.messages).toEqual([m1, m2]);
    expect(count("GET", `/api/conversations/${A}`)).toBe(2);
  });

  it("re-selecting the already-selected conversation does not reload it", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.selectConversation(A));
    await settleMicrotasks();
    expect(count("GET", `/api/conversations/${A}`)).toBe(1);
  });
});

describe("retained send keys are scoped per conversation (FR-009)", () => {
  it("A's network-failed key is reused for the same text in A, never in B; a non-network failure releases it", async () => {
    await mountProvider();
    await select(A);
    act(() => ctx.setDraft("same text"));
    act(() => ctx.sendDraft());
    const first = await next("POST", `/api/conversations/${A}/messages`);
    first.network();
    await waitFor(() => expect(ctx.state.lastError?.kind).toBe("network"));

    act(() => ctx.sendDraft()); // same text, same conversation ⇒ idempotent replay
    const second = await next("POST", `/api/conversations/${A}/messages`);
    const keyA = (first.body as { clientMessageId: string }).clientMessageId;
    expect((second.body as { clientMessageId: string }).clientMessageId).toBe(keyA);
    second.network();
    await waitFor(() => expect(ctx.state.sending).toBe(false));

    await select(B);
    act(() => ctx.setDraft("same text"));
    act(() => ctx.sendDraft());
    const inB = await next("POST", `/api/conversations/${B}/messages`);
    expect((inB.body as { clientMessageId: string }).clientMessageId).not.toBe(keyA);
    inB.respond(400, envelope("VALIDATION_FAILED", "Request validation failed."));
    await waitFor(() => expect(ctx.state.lastError?.kind).toBe("validation"));

    act(() => ctx.sendDraft()); // after a non-network failure the key is released
    const afterValidation = await next("POST", `/api/conversations/${B}/messages`);
    expect((afterValidation.body as { clientMessageId: string }).clientMessageId).not.toBe((inB.body as { clientMessageId: string }).clientMessageId);
  });
});

describe("StrictMode + URL selection", () => {
  it("?c= under StrictMode loads the conversation once and seeds its active response once", async () => {
    const um = userMessage(A, 1, "hi");
    const active = response(A, um.id, "streaming");
    window.history.replaceState(null, "", `/?c=${A}`);
    render(
      <StrictMode>
        <ChatProvider baseUrl={BASE}>
          <App />
        </ChatProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(count("GET", "/api/conversations")).toBeGreaterThan(0));
    for (const list of calls.filter((c) => c.path === "/api/conversations" && !c.settled)) list.respond(200, { conversations: [conversation(A)] });
    (await next("GET", `/api/conversations/${A}`)).respond(200, detail(A, [um], [active]));

    // StrictMode may open, abort and reopen the stream once; deliver on the live (non-aborted) request.
    let live: PendingCall | undefined;
    await waitFor(() => {
      live = calls.find((c) => c.path === `/api/responses/${active.id}/events` && c.signal?.aborted !== true && !c.settled);
      expect(live).toBeDefined();
    });
    const stream = live?.stream();
    stream?.push(`id: 1\nevent: response.started\ndata: ${JSON.stringify({ responseId: active.id, conversationId: A, seq: 1 })}\n\n`);
    stream?.push(`id: 2\nevent: response.delta\ndata: ${JSON.stringify({ responseId: active.id, seq: 2, text: "Mock reply" })}\n\n`);
    await waitFor(() => expect(document.body.textContent).toContain("Mock reply"));
    await settleMicrotasks();

    expect(count("GET", `/api/conversations/${A}`)).toBe(1);
    expect(new URL(window.location.href).searchParams.get("c")).toBe(A);
    const occurrences = (document.body.textContent ?? "").split("Mock reply").length - 1;
    expect(occurrences).toBe(1); // seeded once (empty), text from the replay only — never doubled
    const openStreams = calls.filter((c) => c.path === `/api/responses/${active.id}/events` && c.signal?.aborted !== true);
    expect(openStreams).toHaveLength(1);
  });
});
