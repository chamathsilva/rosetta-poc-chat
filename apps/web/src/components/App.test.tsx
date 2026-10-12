/**
 * SPECS §6.5, §9.2, §9.3, §9.6, §10 (FR-001, FR-007, FR-008, AC-002, AC-013,
 * AC-018, AC-020, AC-022). The real App + ChatProvider under StrictMode over an
 * in-memory fake API: fetch is stubbed (no network, no native SSE object, no
 * polyfill), and every SSE frame is pushed explicitly by the test, so stream
 * progress is deterministic. Expected texts come from the SPECS §9.6 table.
 */
import {
  conversationSchema,
  messageSchema,
  responseSchema,
  type Conversation,
  type Message,
  type Response as WireResponse,
} from "@rosetta-poc/chat-shared";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatProvider } from "../state/ChatProvider";
import { App } from "./App";

const BASE = "http://api.test";
const T = "2026-09-28T10:00:00.000Z";

// ---------------------------------------------------------------- in-memory fake API

type StoredEvent = { seq: number; type: string; data: Record<string, unknown> };
type Override = { match: (method: string, path: string) => boolean; reply: () => Promise<globalThis.Response> };

class FakeApi {
  readonly calls: { method: string; path: string; body: unknown; lastEventId: string | null }[] = [];
  private idCounter = 0;
  private updatedSeq = 0;
  private readonly conversations = new Map<string, { conversation: Conversation; updatedSeq: number }>();
  private readonly messages = new Map<string, Message[]>();
  private readonly responses = new Map<string, WireResponse>();
  private readonly order: string[] = [];
  private readonly events = new Map<string, StoredEvent[]>();
  private readonly live = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  private readonly keys = new Map<string, { userMessageId: string; responseId: string; content: string }>();
  private readonly overrides: Override[] = [];
  private readonly holds: { match: Override["match"]; gate: Promise<void>; release: () => void }[] = [];

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<globalThis.Response> => {
    const method = init.method ?? "GET";
    const path = input.slice(BASE.length);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const lastEventId = new Headers(init.headers).get("last-event-id");
    this.calls.push({ method, path, body, lastEventId });
    const held = this.holds.findIndex((h) => h.match(method, path));
    if (held !== -1) {
      const [h] = this.holds.splice(held, 1);
      this.released.push(h?.release ?? (() => {}));
      await h?.gate; // the request is in flight until the test releases it
    }
    const override = this.overrides.findIndex((o) => o.match(method, path));
    if (override !== -1) {
      const [o] = this.overrides.splice(override, 1);
      if (o !== undefined) return o.reply();
    }
    return this.route(method, path, body, lastEventId, init.signal ?? null);
  };

  private readonly released: (() => void)[] = [];

  /** The next matching request stays in flight until release() is called, then routes normally. */
  holdNext(match: Override["match"]): { release(): void } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.holds.push({ match, gate, release });
    return { release };
  }

  /** Teardown: never leave a held request pending, even if a test failed first. */
  releaseAll(): void {
    for (const h of this.holds.splice(0)) h.release();
    for (const release of this.released.splice(0)) release();
  }

  /** One-shot: the next matching request gets this reply instead of the normal route. */
  overrideOnce(match: Override["match"], reply: Override["reply"]): void {
    this.overrides.push({ match, reply });
  }

  lastResponseId(): string {
    const id = this.order.at(-1);
    if (id === undefined) throw new Error("no response yet");
    return id;
  }

  liveCount(responseId: string): number {
    return this.live.get(responseId)?.size ?? 0;
  }

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }

  // ---- provider-side controls (the test is the provider)
  start(responseId: string): void {
    const r = this.mustResponse(responseId);
    this.setResponse({ ...r, status: "streaming" });
    this.emit(responseId, "response.started", { responseId, conversationId: r.conversationId });
  }

  delta(responseId: string, text: string): void {
    const r = this.mustResponse(responseId);
    this.setResponse({ ...r, partialText: r.partialText + text });
    this.emit(responseId, "response.delta", { responseId, text });
  }

  complete(responseId: string): void {
    const r = this.mustResponse(responseId);
    const list = this.messages.get(r.conversationId) ?? [];
    const assistant = messageSchema.parse({
      id: this.id(), conversationId: r.conversationId, seq: list.length + 1, role: "assistant",
      content: r.partialText, clientMessageId: null, createdAt: T,
    });
    list.push(assistant);
    this.setResponse({ ...r, status: "completed", assistantMessageId: assistant.id });
    this.emit(responseId, "response.completed", { responseId, assistantMessage: assistant });
  }

  fail(responseId: string): void {
    const r = this.mustResponse(responseId);
    const failure = { code: "PROVIDER_ERROR", message: "The assistant could not complete this response." } as const;
    this.setResponse({ ...r, status: "failed", failure });
    this.emit(responseId, "response.failed", { responseId, failure });
  }

  // ---- internals
  private id(): string {
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${this.idCounter.toString(16).padStart(12, "0")}`;
  }

  private mustResponse(id: string): WireResponse {
    const r = this.responses.get(id);
    if (r === undefined) throw new Error(`unknown response ${id}`);
    return r;
  }

  private setResponse(r: WireResponse): void {
    this.responses.set(r.id, responseSchema.parse(r));
  }

  private wire(r: WireResponse): WireResponse {
    const replacement = [...this.responses.values()].find((x) => x.retryOfResponseId === r.id);
    return { ...r, retriedByResponseId: replacement?.id ?? null };
  }

  private frame(e: StoredEvent): Uint8Array {
    return new TextEncoder().encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  }

  private emit(responseId: string, type: string, data: Record<string, unknown>): void {
    const list = this.events.get(responseId) ?? [];
    const event: StoredEvent = { seq: list.length + 1, type, data: { ...data, seq: list.length + 1 } };
    list.push(event);
    this.events.set(responseId, list);
    const terminal = type === "response.completed" || type === "response.failed";
    for (const controller of [...(this.live.get(responseId) ?? [])]) {
      controller.enqueue(this.frame(event));
      if (terminal) controller.close();
    }
    if (terminal) this.live.delete(responseId);
  }

  private json(status: number, body: unknown): globalThis.Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  private envelope(status: number, code: string, message: string): globalThis.Response {
    return this.json(status, { error: { code, message, requestId: "req-1" } });
  }

  private touch(conversationId: string): void {
    const entry = this.conversations.get(conversationId);
    if (entry !== undefined) entry.updatedSeq = ++this.updatedSeq;
  }

  private active(conversationId: string): boolean {
    return [...this.responses.values()].some((r) => r.conversationId === conversationId && (r.status === "pending" || r.status === "streaming"));
  }

  private newResponse(conversationId: string, userMessageId: string, retryOf: string | null): WireResponse {
    const r = responseSchema.parse({
      id: this.id(), conversationId, userMessageId, assistantMessageId: null, status: "pending", partialText: "",
      failure: null, retryOfResponseId: retryOf, retriedByResponseId: null, createdAt: T, updatedAt: T,
    });
    this.responses.set(r.id, r);
    this.order.push(r.id);
    return r;
  }

  private route(method: string, path: string, body: unknown, lastEventId: string | null, signal: AbortSignal | null): globalThis.Response {
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/api/conversations") {
      const conversation = conversationSchema.parse({ id: this.id(), title: "New conversation", createdAt: T, updatedAt: T });
      this.conversations.set(conversation.id, { conversation, updatedSeq: ++this.updatedSeq });
      this.messages.set(conversation.id, []);
      return this.json(201, { conversation });
    }
    if (method === "GET" && path === "/api/conversations") {
      const conversations = [...this.conversations.values()]
        .sort((a, b) => b.updatedSeq - a.updatedSeq)
        .map(({ conversation: c }) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
      return this.json(200, { conversations });
    }
    if (method === "GET" && (m = path.match(/^\/api\/conversations\/([^/]+)$/u)) !== null) {
      const id = m[1] ?? "";
      const entry = this.conversations.get(id);
      if (entry === undefined) return this.envelope(404, "NOT_FOUND", "Conversation not found.");
      const responses = this.order.map((rid) => this.mustResponse(rid)).filter((r) => r.conversationId === id).map((r) => this.wire(r));
      return this.json(200, {
        conversation: entry.conversation,
        messages: this.messages.get(id) ?? [],
        responses,
        activeResponse: responses.find((r) => r.status === "pending" || r.status === "streaming") ?? null,
      });
    }
    if (method === "POST" && (m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/u)) !== null) {
      const id = m[1] ?? "";
      const entry = this.conversations.get(id);
      if (entry === undefined) return this.envelope(404, "NOT_FOUND", "Conversation not found.");
      const { clientMessageId, content } = body as { clientMessageId: string; content: string };
      const normalized = content.trim();
      if (normalized === "") return this.envelope(400, "VALIDATION_FAILED", "Message content must not be empty.");
      const known = this.keys.get(`${id}|${clientMessageId}`);
      if (known !== undefined) {
        if (known.content !== normalized) return this.envelope(409, "IDEMPOTENCY_KEY_CONFLICT", "This clientMessageId was already used with different content.");
        const userMessage = (this.messages.get(id) ?? []).find((x) => x.id === known.userMessageId);
        return this.json(202, { conversationId: id, userMessage, response: this.wire(this.mustResponse(known.responseId)) });
      }
      if (this.active(id)) return this.envelope(409, "RESPONSE_ALREADY_ACTIVE", "This conversation already has a response in progress.");
      const list = this.messages.get(id) ?? [];
      const userMessage = messageSchema.parse({ id: this.id(), conversationId: id, seq: list.length + 1, role: "user", content: normalized, clientMessageId, createdAt: T });
      list.push(userMessage);
      if (list.filter((x) => x.role === "user").length === 1) {
        entry.conversation = { ...entry.conversation, title: normalized.replace(/\s+/gu, " ").slice(0, 60) };
      }
      const response = this.newResponse(id, userMessage.id, null);
      this.keys.set(`${id}|${clientMessageId}`, { userMessageId: userMessage.id, responseId: response.id, content: normalized });
      this.touch(id);
      return this.json(202, { conversationId: id, userMessage, response: this.wire(response) });
    }
    if (method === "POST" && (m = path.match(/^\/api\/responses\/([^/]+)\/retry$/u)) !== null) {
      const target = this.responses.get(m[1] ?? "");
      if (target === undefined) return this.envelope(404, "NOT_FOUND", "Response not found.");
      if (target.retryOfResponseId !== null) return this.envelope(409, "RETRY_NOT_ALLOWED", "A replacement response cannot be retried.");
      const existing = [...this.responses.values()].find((x) => x.retryOfResponseId === target.id);
      if (existing !== undefined) return this.json(202, { conversationId: target.conversationId, responseId: existing.id, retryOfResponseId: target.id });
      if (target.status !== "failed") return this.envelope(409, "RESPONSE_NOT_FAILED", "Only a failed response can be retried.");
      if (this.active(target.conversationId)) return this.envelope(409, "RESPONSE_ALREADY_ACTIVE", "This conversation already has a response in progress.");
      const replacement = this.newResponse(target.conversationId, target.userMessageId, target.id);
      return this.json(202, { conversationId: target.conversationId, responseId: replacement.id, retryOfResponseId: target.id });
    }
    if (method === "GET" && (m = path.match(/^\/api\/responses\/([^/]+)\/events$/u)) !== null) {
      const id = m[1] ?? "";
      if (!this.responses.has(id)) return this.envelope(404, "NOT_FOUND", "Response not found.");
      const after = Number(lastEventId ?? "0");
      const stored = this.events.get(id) ?? [];
      if (after > stored.length) return this.envelope(400, "LAST_EVENT_ID_OUT_OF_RANGE", "Last-Event-ID is beyond the last event of this response.");
      const terminal = stored.some((e) => e.type === "response.completed" || e.type === "response.failed");
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          for (const e of stored.filter((x) => x.seq > after)) controller.enqueue(this.frame(e));
          if (terminal) {
            controller.close();
            return;
          }
          const set = this.live.get(id) ?? new Set();
          set.add(controller);
          this.live.set(id, set);
          signal?.addEventListener("abort", () => {
            set.delete(controller);
            try { controller.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ }
          });
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return this.envelope(404, "NOT_FOUND", "Route not found.");
  }
}

// ---------------------------------------------------------------- harness

let api: FakeApi;
beforeEach(() => {
  api = new FakeApi();
  vi.stubGlobal("fetch", vi.fn(api.fetch));
});
afterEach(() => {
  api.releaseAll(); // release any held request first, so nothing stays pending on failure
  cleanup(); // unmount: aborts every open stream before fetch is unstubbed
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderApp(url = "/"): void {
  window.history.replaceState(null, "", url);
  render(
    <StrictMode>
      <ChatProvider baseUrl={BASE}>
        <App />
      </ChatProvider>
    </StrictMode>,
  );
}

const messageList = () => screen.getByRole("list", { name: "Messages" });
const composer = () => screen.getByRole("textbox", { name: "Message" });
const assistantTexts = (): string[] =>
  within(messageList()).queryAllByRole("article", { name: "Assistant said" }).map((a) => a.querySelector(".message-text")?.textContent ?? "");
const userArticles = () => within(messageList()).queryAllByRole("article", { name: "You said" });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const selectedId = () => new URL(window.location.href).searchParams.get("c");

async function sendAndOpenStream(user: ReturnType<typeof userEvent.setup>, text: string): Promise<string> {
  await user.type(composer(), text);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(api.count("POST", `/api/conversations/${selectedId()}/messages`)).toBeGreaterThan(0));
  const responseId = api.lastResponseId();
  await waitFor(() => expect(api.liveCount(responseId)).toBe(1)); // the client is attached
  return responseId;
}

async function createConversation(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  await waitFor(() => expect((composer() as HTMLTextAreaElement).disabled).toBe(false));
}

// ---------------------------------------------------------------- named tests

describe("App", () => {
  it("create → send → ordered deltas → completed message", async () => {
    renderApp();
    const user = userEvent.setup();
    await createConversation(user);
    const rid = await sendAndOpenStream(user, "hello world");

    api.start(rid);
    const steps: [string, string][] = [["Mock reply: ", "Mock reply:"], ["hello ", "Mock reply: hello"], ["world", "Mock reply: hello world"]];
    for (const [chunk, expected] of steps) {
      api.delta(rid, chunk);
      await waitFor(() => expect(assistantTexts().map((t) => t.trim())).toEqual([expected]));
    }
    expect(screen.getByText("Responding…")).toBeTruthy();
    api.complete(rid);
    await waitFor(() => expect(within(messageList()).getByText("Response complete")).toBeTruthy());

    expect(userArticles().map((a) => a.textContent)).toEqual(["hello world"]);
    expect(assistantTexts()).toEqual(["Mock reply: hello world"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Assistant response complete."));
  });

  it("refresh mid-stream restores selection from ?c= and resumes without duplicate messages or deltas", async () => {
    renderApp();
    const user = userEvent.setup();
    await createConversation(user);
    const rid = await sendAndOpenStream(user, "resume me");
    api.start(rid);
    api.delta(rid, "Mock reply: ");
    api.delta(rid, "resume ");
    await waitFor(() => expect(assistantTexts()).toEqual(["Mock reply: resume "]));
    const conversationId = selectedId();
    expect(conversationId).not.toBeNull();

    // "Refresh": unmount everything (streams abort), then start again from the URL alone.
    cleanup();
    await waitFor(() => expect(api.liveCount(rid)).toBe(0));
    const loadsBefore = api.count("GET", `/api/conversations/${conversationId}`);
    renderApp(`/?c=${conversationId}`);

    await waitFor(() => expect(assistantTexts()).toEqual(["Mock reply: resume "])); // replayed from 0, once
    await waitFor(() => expect(api.liveCount(rid)).toBe(1));
    const reattach = api.calls.filter((c) => c.path === `/api/responses/${rid}/events`).at(-1);
    expect(reattach?.lastEventId).toBe("0");
    api.delta(rid, "me");
    api.complete(rid);
    await waitFor(() => expect(within(messageList()).getByText("Response complete")).toBeTruthy());

    expect(selectedId()).toBe(conversationId);
    expect(api.count("GET", `/api/conversations/${conversationId}`) - loadsBefore).toBe(1); // StrictMode: one load
    expect(userArticles().map((a) => a.textContent)).toEqual(["resume me"]);
    expect(assistantTexts()).toEqual(["Mock reply: resume me"]); // no repeated delta text
  });

  it("network / API error / validation error / provider failure each produce a distinct announced state with one usable next action", async () => {
    renderApp();
    const user = userEvent.setup();
    await createConversation(user);
    const sendPath = (method: string, path: string) => method === "POST" && path.endsWith("/messages");
    const reloadButton = () => screen.queryByRole("button", { name: "Reload" });
    const retryButton = () => screen.queryByRole("button", { name: "Retry" });
    const errorKind = () => document.getElementById("composer-error")?.dataset.errorKind;
    const seen: string[] = [];

    // 1) Network: fetch rejects ⇒ next action: press Send again (retry-send).
    api.overrideOnce(sendPath, () => Promise.reject(new TypeError("Failed to fetch")));
    await user.type(composer(), "net");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(alertText()).toBe("Network error. The server could not be reached."));
    expect(errorKind()).toBe("network");
    expect(screen.getByText(/Press Send to try again\./u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    expect([reloadButton(), retryButton()]).toEqual([null, null]);
    seen.push(alertText());

    // 2) API error: a server-kind envelope ⇒ next action: Reload.
    api.overrideOnce(sendPath, () =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: "RESPONSE_ALREADY_ACTIVE", message: "This conversation already has a response in progress.", requestId: "r" } }), { status: 409 })));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(alertText()).toBe("Server error. This conversation already has a response in progress."));
    expect(errorKind()).toBe("server");
    expect(reloadButton()).toBeTruthy();
    expect(retryButton()).toBeNull();
    seen.push(alertText());

    // 3) Validation: whitespace-only content ⇒ next action: fix the input.
    await user.clear(composer());
    await user.type(composer(), "   ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(alertText()).toBe("Message not sent. Message content must not be empty."));
    expect(errorKind()).toBe("validation");
    expect(composer().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Edit your message and send it again\./u)).toBeTruthy();
    expect([reloadButton(), retryButton()]).toEqual([null, null]);
    seen.push(alertText());

    // 4) Provider failure on the stream ⇒ next action: Retry.
    await user.clear(composer());
    const rid = await sendAndOpenStream(user, "provider please");
    api.start(rid);
    api.fail(rid);
    await waitFor(() => expect(alertText()).toBe("Response failed. The assistant could not complete this response."));
    expect(retryButton()).toBeTruthy();
    expect(within(messageList()).getByText("Response failed")).toBeTruthy();
    expect(reloadButton()).toBeNull();
    seen.push(alertText());

    expect(new Set(seen).size).toBe(4); // four distinguishable announced states
  });

  it("`<img src=x onerror=…>` renders as text, `querySelector('img')` is null", async () => {
    renderApp();
    const user = userEvent.setup();
    await createConversation(user);
    const payload = "<img src=x onerror=alert(1)> <script>alert(1)</script>";
    const rid = await sendAndOpenStream(user, payload);
    api.start(rid);
    api.delta(rid, `Mock reply: ${payload}`);
    api.complete(rid);
    await waitFor(() => expect(within(messageList()).getByText("Response complete")).toBeTruthy());

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(userArticles().map((a) => a.textContent)).toEqual([payload]);
    expect(assistantTexts()).toEqual([`Mock reply: ${payload}`]);
  });

  it("keyboard-only create → select → send → observe status → retry", async () => {
    renderApp();
    const user = userEvent.setup();
    const active = () => document.activeElement;

    // Create A with the keyboard: skip link → New conversation → Enter.
    await user.tab();
    expect(active()?.textContent).toBe("Skip to message input");
    await user.tab();
    expect(active()?.textContent).toBe("New conversation");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(active()?.id).toBe("composer-input"));
    const a = selectedId();

    // Send in A; the provider fails; the status is visible and announced.
    await user.keyboard("keyboard first{Enter}");
    await waitFor(() => expect(api.count("POST", `/api/conversations/${a}/messages`)).toBe(1));
    const original = api.lastResponseId();
    await waitFor(() => expect(api.liveCount(original)).toBe(1));
    api.start(original);
    api.fail(original);
    await waitFor(() => expect(within(messageList()).getByText("Response failed")).toBeTruthy());
    expect(alertText()).toBe("Response failed. The assistant could not complete this response.");

    // Create B, then select A again — keyboard only.
    await user.tab({ shift: true }); // composer → A's conversation button
    await user.tab({ shift: true }); // → New conversation
    expect(active()?.textContent).toBe("New conversation");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(selectedId()).not.toBe(a));
    await waitFor(() => expect(active()?.id).toBe("composer-input"));
    await user.tab({ shift: true }); // composer → the last conversation button (A; list is newest first)
    expect(active()?.getAttribute("aria-current")).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(selectedId()).toBe(a));
    await waitFor(() => expect(within(messageList()).getByText("Response failed")).toBeTruthy());

    // composer → Send → Retry, then Enter.
    await user.tab();
    expect(active()?.id).toBe("composer-input");
    await user.tab();
    expect(active()?.textContent).toBe("Send");
    await user.tab();
    expect(active()?.textContent).toBe("Retry");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.count("POST", `/api/responses/${original}/retry`)).toBe(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    await waitFor(() => expect(active()?.id).toBe("composer-input"));

    const replacement = api.lastResponseId();
    await waitFor(() => expect(api.liveCount(replacement)).toBe(1));
    api.start(replacement);
    api.delta(replacement, "Mock reply: keyboard first");
    api.complete(replacement);
    await waitFor(() => expect(within(messageList()).getByText("Response complete")).toBeTruthy());
    expect(userArticles()).toHaveLength(1);
  });

  it("retry click issues one retry request and does not duplicate the user message", async () => {
    renderApp();
    const user = userEvent.setup();
    await createConversation(user);
    const original = await sendAndOpenStream(user, "retry me once");
    api.start(original);
    api.fail(original);
    const retry = await screen.findByRole("button", { name: "Retry" });

    // Hold the retry request in flight, so the second click lands on a still-mounted button.
    const hold = api.holdNext((method, path) => method === "POST" && path === `/api/responses/${original}/retry`);
    await user.click(retry);
    await waitFor(() => expect(api.count("POST", `/api/responses/${original}/retry`)).toBe(1));
    const stillMounted = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(stillMounted.disabled).toBe(true); // status "retrying" disables it (§9.6)
    expect(within(messageList()).getByText("Retrying…")).toBeTruthy();
    await user.click(stillMounted); // a second click while the first request is pending
    expect(api.count("POST", `/api/responses/${original}/retry`)).toBe(1);

    hold.release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    expect(api.count("POST", `/api/responses/${original}/retry`)).toBe(1);

    const replacement = api.lastResponseId();
    expect(replacement).not.toBe(original);
    await waitFor(() => expect(api.liveCount(replacement)).toBe(1));
    api.start(replacement);
    api.delta(replacement, "Mock reply: retry me once");
    api.complete(replacement);
    await waitFor(() => expect(within(messageList()).getByText("Response complete")).toBeTruthy());

    expect(userArticles().map((x) => x.textContent)).toEqual(["retry me once"]);
    // Exactly two assistant items, in order: the failed original (status + fixed failure text, no
    // streamed text, no Retry), then the completed replacement's assistant message.
    const items = within(messageList()).getAllByRole("article", { name: "Assistant said" });
    expect(items).toHaveLength(2);
    const [failedItem, completedItem] = items;
    expect(failedItem?.querySelector(".message-text")).toBeNull();
    expect(failedItem?.querySelector(".message-status")?.textContent).toBe("Response failed");
    expect(failedItem?.querySelector(".message-failure")?.textContent).toBe("The assistant could not complete this response.");
    expect(failedItem?.querySelector("button")).toBeNull();
    expect(completedItem?.querySelector(".message-text")?.textContent).toBe("Mock reply: retry me once");
    expect(completedItem?.querySelector(".message-status")?.textContent).toBe("Response complete");
    expect(api.count("POST", `/api/responses/${original}/retry`)).toBe(1);
  });
});
