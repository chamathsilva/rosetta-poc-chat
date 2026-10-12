/**
 * SPECS §9.3, §9.4, §9.6 (FR-001, FR-007, AC-002, AC-008, AC-013, AC-016,
 * AC-017, AC-018). Every rule is asserted with independently written expected
 * values; inputs are deep-frozen, so any mutation by the reducer throws.
 */
import {
  conversationIdSchema,
  conversationSchema,
  messageIdSchema,
  messageSchema,
  responseIdSchema,
  responseSchema,
  type Conversation,
  type GetConversationResponse,
  type Message,
  type Response as WireResponse,
  type SendMessageAccepted,
  type StreamEvent,
} from "@rosetta-poc/chat-shared";
import { describe, expect, it } from "vitest";
import { chatReducer, initialChatState, type ChatAction, type ChatState, type UiResponse } from "./chat-reducer";
import type { UiError } from "./ui-status";

const C = conversationIdSchema.parse("11111111-1111-4111-8111-111111111111");
const C2 = conversationIdSchema.parse("11111111-1111-4111-8111-222222222222");
const U1 = messageIdSchema.parse("22222222-2222-4222-8222-000000000001");
const A1 = messageIdSchema.parse("22222222-2222-4222-8222-000000000002");
const LOCAL = messageIdSchema.parse("22222222-2222-4222-8222-0000000000ff");
const R1 = responseIdSchema.parse("33333333-3333-4333-8333-000000000001");
const R2 = responseIdSchema.parse("33333333-3333-4333-8333-000000000002");
const T = "2026-09-27T10:00:00.000Z";

const conversation: Conversation = conversationSchema.parse({ id: C, title: "Hello", createdAt: T, updatedAt: T });
const userMessage: Message = messageSchema.parse({ id: U1, conversationId: C, seq: 1, role: "user", content: "hello", clientMessageId: "k1", createdAt: T });
const assistantMessage: Message = messageSchema.parse({ id: A1, conversationId: C, seq: 2, role: "assistant", content: "Mock reply: hello", clientMessageId: null, createdAt: T });
const wire = (overrides: Partial<WireResponse>): WireResponse =>
  responseSchema.parse({
    id: R1, conversationId: C, userMessageId: U1, assistantMessageId: null, status: "pending", partialText: "",
    failure: null, retryOfResponseId: null, retriedByResponseId: null, createdAt: T, updatedAt: T, ...overrides,
  });

const ev = {
  started: (seq = 1, responseId = R1): StreamEvent => ({ type: "response.started", data: { responseId, conversationId: C, seq } }),
  delta: (seq: number, text: string, responseId = R1): StreamEvent => ({ type: "response.delta", data: { responseId, seq, text } }),
  completed: (seq: number, message = assistantMessage, responseId = R1): StreamEvent => ({ type: "response.completed", data: { responseId, seq, assistantMessage: message } }),
  failed: (seq: number, responseId = R1): StreamEvent => ({
    type: "response.failed", data: { responseId, seq, failure: { code: "PROVIDER_DISCONNECTED", message: "The assistant connection was lost." } },
  }),
};

const errors: Record<UiError["kind"], UiError> = {
  validation: { kind: "validation", code: "VALIDATION_FAILED", message: "Message content must not be empty.", nextAction: "fix-input" },
  network: { kind: "network", code: "NETWORK_ERROR", message: "The server could not be reached.", nextAction: "retry-send" },
  server: { kind: "server", code: "NOT_FOUND", message: "Response not found.", nextAction: "reload" },
  provider: { kind: "provider", code: "PROVIDER_ERROR", message: "The assistant could not complete this response.", nextAction: "retry-response" },
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Applies actions one by one, freezing every intermediate state. */
function run(state: ChatState, ...actions: ChatAction[]): ChatState {
  return actions.reduce((current, action) => deepFreeze(chatReducer(deepFreeze(current), action)), state);
}

const selected = (): ChatState => run(initialChatState, { type: "conversation/selected", conversationId: C });
const loaded = (detail: Partial<GetConversationResponse> = {}): ChatState =>
  run(selected(), {
    type: "conversation/loaded",
    detail: { conversation, messages: [userMessage], responses: [], activeResponse: null, ...detail },
  });
const accepted = (responseOverrides: Partial<WireResponse> = {}): SendMessageAccepted => ({
  conversationId: C, userMessage, response: wire(responseOverrides),
});
/** A conversation with one open, freshly accepted response R1 (status "sending"). */
const withOpenResponse = (): ChatState => run(loaded({ messages: [] }), { type: "send/accepted", accepted: accepted() });
const resp = (state: ChatState, id = R1): UiResponse => {
  const response = state.responses[id];
  if (response === undefined) throw new Error(`no response ${id}`);
  return response;
};

describe("initial state (§9.3)", () => {
  it("is empty and idle", () => {
    expect(initialChatState).toEqual({
      conversations: [], conversationsLoad: { kind: "idle" }, selectedConversationId: null, conversationLoad: { kind: "idle" },
      messages: [], responses: {}, draft: "", sending: false, lastError: null, announcement: { politeness: "polite", text: "" },
    });
  });
});

describe("rule 1 — idempotency guard (AC-013, FR-007)", () => {
  it("replayed seq ≤ lastAppliedEventId returns the same state reference", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock ") });
    expect(resp(state).lastAppliedEventId).toBe(2);
    expect(chatReducer(state, { type: "stream/event", event: ev.delta(2, "Mock ") })).toBe(state); // equal seq
    expect(chatReducer(state, { type: "stream/event", event: ev.started(1) })).toBe(state); // lower seq
    expect(chatReducer(state, { type: "stream/event", event: ev.delta(1, "x") })).toBe(state); // lower seq, any type
  });

  it("a replay can never append the same delta twice", () => {
    const once = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock ") });
    const replayed = run(once, { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock ") });
    expect(resp(replayed).text).toBe("Mock ");
  });

  it("an event for an unknown response returns the same state reference", () => {
    const state = withOpenResponse();
    expect(chatReducer(state, { type: "stream/event", event: ev.delta(5, "x", R2) })).toBe(state);
  });

  it("applying an event advances lastAppliedEventId to data.seq", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() });
    expect(resp(state).lastAppliedEventId).toBe(1);
  });
});

describe("rules 2–4 — delta, completed, failed", () => {
  it("rule 2: deltas append in seq order and set status streaming (AC-002)", () => {
    const state = run(withOpenResponse(),
      { type: "stream/event", event: ev.started() },
      { type: "stream/event", event: ev.delta(2, "Mock reply: ") },
      { type: "stream/event", event: ev.delta(3, "hel") },
      { type: "stream/event", event: ev.delta(4, "lo") });
    expect(resp(state)).toMatchObject({ status: "streaming", text: "Mock reply: hello", lastAppliedEventId: 4 });
  });

  it("rule 3: completed overwrites with the authoritative text, closes the stream, appends the assistant message once", () => {
    const streamed = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock reply: hel") });
    const done = run(streamed, { type: "stream/event", event: ev.completed(3) });
    expect(resp(done)).toMatchObject({ status: "completed", text: "Mock reply: hello", streamClosed: true, lastAppliedEventId: 3 });
    expect(done.messages.filter((m) => m.id === A1)).toHaveLength(1);
  });

  it("rule 3: an assistant message whose id is already present is not appended again", () => {
    const withAssistant = run(withOpenResponse(), { type: "conversation/loaded", detail: { conversation, messages: [userMessage, assistantMessage], responses: [wire({ status: "streaming" })], activeResponse: null } });
    const done = run(withAssistant, { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.completed(2) });
    expect(done.messages.map((m) => m.id)).toEqual([U1, A1]);
  });

  it("rule 3: dedupe is by id, never by content — same content under a different id is still appended", () => {
    const sameContentUser = messageSchema.parse({ ...userMessage, content: "Mock reply: hello" });
    const state = run(withOpenResponse(), { type: "conversation/loaded", detail: { conversation, messages: [sameContentUser], responses: [wire({ status: "streaming" })], activeResponse: null } });
    const done = run(state, { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.completed(2) });
    expect(done.messages.map((m) => m.id)).toEqual([U1, A1]);
    expect(done.messages.filter((m) => m.content === "Mock reply: hello")).toHaveLength(2);
  });

  it("rule 4: failed keeps the partial text, records the failure, closes the stream (AC-016)", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock reply: he") }, { type: "stream/event", event: ev.failed(3) });
    expect(resp(state)).toMatchObject({
      status: "failed", text: "Mock reply: he", streamClosed: true,
      failure: { code: "PROVIDER_DISCONNECTED", message: "The assistant connection was lost." },
    });
  });
});

describe("rule 5 — send (AC-008)", () => {
  const requested: ChatAction = { type: "send/requested", clientMessageId: "k1", content: "hello", localMessageId: LOCAL, createdAt: T };

  it("send/requested without a selected conversation returns the same state", () => {
    expect(chatReducer(initialChatState, requested)).toBe(initialChatState);
  });

  it("send/requested sets sending and appends an optimistic message keyed by clientMessageId", () => {
    const state = run(loaded({ messages: [] }), requested);
    expect(state.sending).toBe(true);
    expect(state.messages).toEqual([{ id: LOCAL, conversationId: C, seq: 1, role: "user", content: "hello", clientMessageId: "k1", createdAt: T }]);
    expect(state.announcement).toEqual({ politeness: "polite", text: "Sending message." });
  });

  it("send/accepted replaces the optimistic entry and inserts a sending/0/open response", () => {
    const state = run(loaded({ messages: [] }), requested, { type: "draft/changed", draft: "hello" }, { type: "send/accepted", accepted: accepted() });
    expect(state.messages).toEqual([userMessage]);
    expect(state.sending).toBe(false);
    expect(state.draft).toBe("");
    expect(resp(state)).toEqual({
      id: R1, userMessageId: U1, status: "sending", text: "", lastAppliedEventId: 0, streamClosed: false,
      failure: null, retryOfResponseId: null, retriedByResponseId: null, reconnectAttempt: 0,
    });
  });

  it("a duplicate send returning the original ids reconciles to exactly one message and does not reset its response", () => {
    const first = run(loaded({ messages: [] }), requested, { type: "send/accepted", accepted: accepted() }, { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "Mock ") });
    const replayed = run(first, requested, { type: "send/accepted", accepted: accepted() });
    expect(replayed.messages).toEqual([userMessage]);
    expect(resp(replayed)).toMatchObject({ lastAppliedEventId: 2, text: "Mock ", status: "streaming" });
  });

  it("send/accepted for a conversation no longer selected only clears sending", () => {
    const other = run(initialChatState, { type: "conversation/selected", conversationId: C2 });
    const state = run(other, { type: "send/accepted", accepted: accepted() });
    expect(state.messages).toEqual([]);
    expect(state.responses).toEqual({});
    expect(state.sending).toBe(false);
  });

  it("send/rejected removes the optimistic entry, clears sending, sets the error and an alert", () => {
    const state = run(loaded({ messages: [] }), requested, { type: "send/rejected", clientMessageId: "k1", error: errors.validation });
    expect(state.messages).toEqual([]);
    expect(state.sending).toBe(false);
    expect(state.lastError).toEqual(errors.validation);
    expect(state.announcement).toEqual({ politeness: "assertive", text: "Message not sent. Message content must not be empty." });
  });
});

describe("rule 6 — conversation/loaded seeding (FR-007, AC-013)", () => {
  it("terminal completed ⇒ text from the assistant message, lastAppliedEventId 0, streamClosed", () => {
    const state = loaded({ messages: [userMessage, assistantMessage], responses: [wire({ status: "completed", assistantMessageId: A1, partialText: "Mock reply: hello" })] });
    expect(resp(state)).toMatchObject({ status: "completed", text: "Mock reply: hello", lastAppliedEventId: 0, streamClosed: true });
  });

  it("terminal failed ⇒ text from partialText, failure kept, streamClosed", () => {
    const failure = { code: "PROVIDER_ERROR" as const, message: "The assistant could not complete this response." };
    const state = loaded({ responses: [wire({ status: "failed", partialText: "Mock reply: he", failure })] });
    expect(resp(state)).toMatchObject({ status: "failed", text: "Mock reply: he", failure, lastAppliedEventId: 0, streamClosed: true });
  });

  it.each(["pending", "streaming"] as const)("active (%s) ⇒ empty text from 0, stream open — even when the server already has partial text", (status) => {
    const state = loaded({ responses: [wire({ status, partialText: "Mock reply: hel" })] });
    expect(resp(state)).toMatchObject({ text: "", lastAppliedEventId: 0, streamClosed: false });
  });

  it("AC-013: an active seed replayed from 0 yields the text exactly once — never seeded text + replay", () => {
    const seeded = loaded({ responses: [wire({ status: "streaming", partialText: "Mock reply: hel" })] });
    const replayed = run(seeded,
      { type: "stream/event", event: ev.started() },
      { type: "stream/event", event: ev.delta(2, "Mock reply: ") },
      { type: "stream/event", event: ev.delta(3, "hel") },
      { type: "stream/event", event: ev.delta(4, "lo") });
    expect(resp(replayed).text).toBe("Mock reply: hello");
  });

  it("keeps retry links and sorts messages by seq", () => {
    const state = loaded({
      messages: [assistantMessage, userMessage],
      responses: [wire({ status: "failed", retriedByResponseId: R2, failure: { code: "PROVIDER_ERROR", message: "x" } }), wire({ id: R2, status: "completed", retryOfResponseId: R1, assistantMessageId: A1 })],
    });
    expect(state.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(resp(state)).toMatchObject({ retriedByResponseId: R2 });
    expect(resp(state, R2)).toMatchObject({ retryOfResponseId: R1, text: "Mock reply: hello" });
  });

  it("a load for a conversation that is not selected returns the same state", () => {
    const state = selected();
    expect(chatReducer(state, { type: "conversation/loaded", detail: { conversation: { ...conversation, id: C2 }, messages: [], responses: [], activeResponse: null } })).toBe(state);
  });
});

describe("rule 7 — stream closure and reconnect", () => {
  it("stream/opening leaves state untouched (streamClosed stays false)", () => {
    const state = withOpenResponse();
    expect(chatReducer(state, { type: "stream/opening", responseId: R1 })).toBe(state);
  });

  it("stream/reconnecting on an open active response sets reconnecting and counts attempts", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/reconnecting", responseId: R1 }, { type: "stream/reconnecting", responseId: R1 });
    expect(resp(state)).toMatchObject({ status: "reconnecting", reconnectAttempt: 2 });
    expect(state.announcement).toEqual({ politeness: "polite", text: "Connection lost. Reconnecting." });
  });

  it("a successful event resets reconnectAttempt to 0 and leaves reconnecting", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/reconnecting", responseId: R1 }, { type: "stream/event", event: ev.delta(2, "x") });
    expect(resp(state)).toMatchObject({ status: "streaming", reconnectAttempt: 0 });
  });

  it.each([
    ["after completed", [ev.started(), ev.completed(2)]],
    ["after failed", [ev.started(), ev.failed(2)]],
  ] as const)("stream/reconnecting is ignored %s (stream closed)", (_label, events) => {
    const state = run(withOpenResponse(), ...events.map((event): ChatAction => ({ type: "stream/event", event })));
    expect(chatReducer(state, { type: "stream/reconnecting", responseId: R1 })).toBe(state);
  });

  it("stream/reconnecting is ignored for a stream closed by stream/closed('terminal') and for unknown responses", () => {
    const closed = run(withOpenResponse(), { type: "stream/closed", responseId: R1, reason: "terminal" });
    expect(resp(closed).streamClosed).toBe(true);
    expect(chatReducer(closed, { type: "stream/reconnecting", responseId: R1 })).toBe(closed);
    expect(chatReducer(closed, { type: "stream/reconnecting", responseId: R2 })).toBe(closed);
  });

  it.each(["aborted", "network"] as const)("stream/closed('%s') changes nothing", (reason) => {
    const state = withOpenResponse();
    expect(chatReducer(state, { type: "stream/closed", responseId: R1, reason })).toBe(state);
  });

  it("stream/error closes the stream and surfaces the error", () => {
    const state = run(withOpenResponse(), { type: "stream/error", responseId: R1, error: errors.network });
    expect(resp(state).streamClosed).toBe(true);
    expect(state.lastError).toEqual(errors.network);
    expect(state.announcement).toEqual({ politeness: "assertive", text: "Network error. The server could not be reached." });
  });
});

describe("retry (FR-008, AC-017, A-003)", () => {
  const failedState = (): ChatState => run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.failed(2) });

  it("retry/requested marks the response retrying and announces it", () => {
    const state = run(failedState(), { type: "retry/requested", responseId: R1 });
    expect(resp(state).status).toBe("retrying");
    expect(state.announcement).toEqual({ politeness: "polite", text: "Retrying response." });
  });

  it("retry/accepted links original and replacement, adds no message, and a repeat is idempotent", () => {
    const before = run(failedState(), { type: "retry/requested", responseId: R1 });
    const once = run(before, { type: "retry/accepted", accepted: { conversationId: C, responseId: R2, retryOfResponseId: R1 } });
    const twice = run(once, { type: "retry/accepted", accepted: { conversationId: C, responseId: R2, retryOfResponseId: R1 } });
    expect(resp(once)).toMatchObject({ status: "failed", retriedByResponseId: R2 });
    expect(resp(once, R2)).toMatchObject({ retryOfResponseId: R1, userMessageId: U1, text: "", lastAppliedEventId: 0, streamClosed: false });
    expect(once.messages).toEqual(before.messages);
    expect(resp(twice, R2)).toEqual(resp(once, R2));
  });

  it("retry/accepted for an unknown original returns the same state", () => {
    const state = failedState();
    expect(chatReducer(state, { type: "retry/accepted", accepted: { conversationId: C, responseId: R2, retryOfResponseId: responseIdSchema.parse("33333333-3333-4333-8333-0000000000aa") } })).toBe(state);
  });

  it("retry/rejected restores failed and surfaces a server alert", () => {
    const state = run(failedState(), { type: "retry/requested", responseId: R1 }, { type: "retry/rejected", responseId: R1, error: errors.server });
    expect(resp(state).status).toBe("failed");
    expect(state.lastError).toEqual(errors.server);
    expect(state.announcement).toEqual({ politeness: "assertive", text: "Server error. Response not found." });
  });
});

describe("conversation list, selection, creation, draft, dismissal", () => {
  it("conversations/loading, loaded and failed", () => {
    const loading = run(initialChatState, { type: "conversations/loading" });
    expect(loading.conversationsLoad).toEqual({ kind: "loading" });
    const summaries = [{ id: C, title: "Hello", updatedAt: T }];
    expect(run(loading, { type: "conversations/loaded", conversations: summaries })).toMatchObject({ conversations: summaries, conversationsLoad: { kind: "ready" } });
    const failed = run(loading, { type: "conversations/failed", error: errors.server });
    expect(failed.conversationsLoad).toEqual({ kind: "error", error: errors.server });
    expect(failed.announcement.politeness).toBe("assertive");
  });

  it("selecting another conversation resets per-conversation state; re-selecting the same one is a no-op", () => {
    const busy = run(withOpenResponse(), { type: "draft/changed", draft: "typing" });
    expect(chatReducer(busy, { type: "conversation/selected", conversationId: C })).toBe(busy);
    const switched = run(busy, { type: "conversation/selected", conversationId: C2 });
    expect(switched).toMatchObject({ selectedConversationId: C2, messages: [], responses: {}, draft: "", sending: false, conversationLoad: { kind: "idle" } });
  });

  it("conversation/loading and conversation/failed", () => {
    expect(run(selected(), { type: "conversation/loading" }).conversationLoad).toEqual({ kind: "loading" });
    const failed = run(selected(), { type: "conversation/failed", error: errors.server });
    expect(failed.conversationLoad).toEqual({ kind: "error", error: errors.server });
    expect(failed.lastError).toEqual(errors.server);
  });

  it("conversation/created prepends its summary once and selects it, ready and empty", () => {
    const existing = run(initialChatState, { type: "conversations/loaded", conversations: [{ id: C2, title: "Older", updatedAt: T }] });
    const created = run(existing, { type: "conversation/created", conversation }, { type: "conversation/created", conversation });
    expect(created.conversations.map((c) => c.id)).toEqual([C, C2]);
    expect(created).toMatchObject({ selectedConversationId: C, conversationLoad: { kind: "ready" }, messages: [], responses: {} });
  });

  it("draft/changed stores the draft verbatim", () => {
    expect(run(initialChatState, { type: "draft/changed", draft: "  a\nb  " }).draft).toBe("  a\nb  ");
  });

  it("error/dismissed clears lastError; with no error it returns the same state", () => {
    const withError = run(loaded(), { type: "conversation/failed", error: errors.server });
    expect(run(withError, { type: "error/dismissed" }).lastError).toBeNull();
    expect(chatReducer(initialChatState, { type: "error/dismissed" })).toBe(initialChatState);
  });
});

describe("rule 8 — announcements follow the fixed §9.6 table (AC-018)", () => {
  it("the four error kinds produce four distinct assertive texts", () => {
    const texts = (Object.keys(errors) as UiError["kind"][]).map((kind) =>
      run(withOpenResponse(), { type: "stream/error", responseId: R1, error: errors[kind] }).announcement);
    expect(texts).toEqual([
      { politeness: "assertive", text: "Message not sent. Message content must not be empty." },
      { politeness: "assertive", text: "Network error. The server could not be reached." },
      { politeness: "assertive", text: "Server error. Response not found." },
      { politeness: "assertive", text: "Response failed. The assistant could not complete this response." },
    ]);
  });

  it("streaming, completed and failed announce their fixed texts", () => {
    const streaming = run(withOpenResponse(), { type: "stream/event", event: ev.started() });
    expect(streaming.announcement).toEqual({ politeness: "polite", text: "Assistant is responding." });
    expect(run(streaming, { type: "stream/event", event: ev.completed(2) }).announcement).toEqual({ politeness: "polite", text: "Assistant response complete." });
    expect(run(streaming, { type: "stream/event", event: ev.failed(2) }).announcement).toEqual({ politeness: "assertive", text: "Response failed. The assistant connection was lost." });
  });

  it("streamed delta text never reaches the announcement", () => {
    const state = run(withOpenResponse(), { type: "stream/event", event: ev.started() }, { type: "stream/event", event: ev.delta(2, "SECRET-DELTA-TEXT") }, { type: "stream/event", event: ev.delta(3, " more") });
    expect(state.announcement.text).toBe("Assistant is responding.");
    expect(JSON.stringify(state.announcement)).not.toContain("SECRET");
  });
});

describe("purity (§9.3)", () => {
  it("never mutates its input state (all inputs are deep-frozen)", () => {
    const frozen = deepFreeze(run(withOpenResponse(), { type: "stream/event", event: ev.started() }));
    const snapshot = JSON.stringify(frozen);
    run(frozen,
      { type: "stream/event", event: ev.delta(2, "x") },
      { type: "stream/reconnecting", responseId: R1 },
      { type: "retry/requested", responseId: R1 },
      { type: "draft/changed", draft: "abc" },
      { type: "conversation/selected", conversationId: C2 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
