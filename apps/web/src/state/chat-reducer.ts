/**
 * Chat reducer — apps/web/src/state/chat-reducer.ts. SPECS §9.3, §9.4, §9.6
 * (FR-001, FR-007, AC-002, AC-008, AC-013, AC-016, AC-018).
 *
 * PURE: no clock, no network, no randomness, no module-level mutable state,
 * no UI library. It is the only place ChatState changes; IO and timers live
 * in ChatProvider and the hooks. Payloads that need a timestamp or an id (the
 * optimistic message) are built by the caller.
 */
import type {
  Conversation,
  ConversationId,
  ConversationSummary,
  GetConversationResponse,
  Message,
  MessageId,
  Response as WireResponse,
  ResponseFailure,
  ResponseId,
  RetryAccepted,
  SendMessageAccepted,
  StreamEvent,
} from "@rosetta-poc/chat-shared";
import {
  errorAnnouncement,
  statusAnnouncement,
  type Announcement,
  type UiError,
  type UiResponseStatus,
} from "./ui-status";

export type LoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly error: UiError };

export interface UiResponse {
  readonly id: ResponseId;
  readonly userMessageId: MessageId;
  readonly status: UiResponseStatus;
  readonly text: string;
  readonly lastAppliedEventId: number; // 0 = nothing applied
  readonly streamClosed: boolean; // terminal or explicitly closed; never reconnect
  readonly failure: ResponseFailure | null;
  readonly retryOfResponseId: ResponseId | null;
  readonly retriedByResponseId: ResponseId | null;
  readonly reconnectAttempt: number;
}

export interface ChatState {
  readonly conversations: readonly ConversationSummary[];
  readonly conversationsLoad: LoadState;
  readonly selectedConversationId: ConversationId | null;
  readonly conversationLoad: LoadState;
  readonly messages: readonly Message[]; // sorted by seq asc
  readonly responses: Readonly<Record<string, UiResponse>>;
  readonly draft: string;
  readonly sending: boolean;
  readonly lastError: UiError | null;
  readonly announcement: Announcement;
}

/** The action union, exhaustively (SPECS §9.4). */
export type ChatAction =
  | { readonly type: "conversations/loading" }
  | { readonly type: "conversations/loaded"; readonly conversations: readonly ConversationSummary[] }
  | { readonly type: "conversations/failed"; readonly error: UiError }
  | { readonly type: "conversation/selected"; readonly conversationId: ConversationId | null }
  | { readonly type: "conversation/loading" }
  | { readonly type: "conversation/loaded"; readonly detail: GetConversationResponse }
  | { readonly type: "conversation/failed"; readonly error: UiError }
  | { readonly type: "conversation/created"; readonly conversation: Conversation }
  | { readonly type: "draft/changed"; readonly draft: string }
  | {
      readonly type: "send/requested";
      readonly clientMessageId: string;
      readonly content: string;
      readonly localMessageId: MessageId; // provisional id, replaced on send/accepted
      readonly createdAt: string;
    }
  | { readonly type: "send/accepted"; readonly accepted: SendMessageAccepted }
  | { readonly type: "send/rejected"; readonly clientMessageId: string; readonly error: UiError }
  | { readonly type: "stream/opening"; readonly responseId: ResponseId }
  | { readonly type: "stream/reconnecting"; readonly responseId: ResponseId }
  | { readonly type: "stream/event"; readonly event: StreamEvent }
  | { readonly type: "stream/error"; readonly responseId: ResponseId; readonly error: UiError }
  | {
      readonly type: "stream/closed";
      readonly responseId: ResponseId;
      readonly reason: "terminal" | "aborted" | "network";
    }
  | { readonly type: "retry/requested"; readonly responseId: ResponseId }
  | { readonly type: "retry/accepted"; readonly accepted: RetryAccepted }
  | { readonly type: "retry/rejected"; readonly responseId: ResponseId; readonly error: UiError }
  | { readonly type: "error/dismissed" };

export const initialChatState: ChatState = {
  conversations: [],
  conversationsLoad: { kind: "idle" },
  selectedConversationId: null,
  conversationLoad: { kind: "idle" },
  messages: [],
  responses: {},
  draft: "",
  sending: false,
  lastError: null,
  announcement: { politeness: "polite", text: "" },
};

function isActive(status: WireResponse["status"]): boolean {
  return status === "pending" || status === "streaming";
}

function bySeq(messages: readonly Message[]): readonly Message[] {
  return [...messages].sort((a, b) => a.seq - b.seq);
}

/** Adds a message unless one with that id is present — dedupe by id, never by content (rule 3). */
function withMessage(messages: readonly Message[], message: Message): readonly Message[] {
  return messages.some((m) => m.id === message.id) ? messages : bySeq([...messages, message]);
}

function withResponse(state: ChatState, response: UiResponse): ChatState["responses"] {
  return { ...state.responses, [response.id]: response };
}

/**
 * Rule 6 seeding (FR-007, AC-013): terminal ⇒ seed the text, streamClosed,
 * never stream; active ⇒ empty text from 0 and let replay rebuild it. Mixing
 * seeded text with a replay from 0 is the duplication bug AC-013 forbids.
 */
function seedResponse(response: WireResponse, messages: readonly Message[]): UiResponse {
  const base = {
    id: response.id,
    userMessageId: response.userMessageId,
    lastAppliedEventId: 0,
    failure: response.failure,
    retryOfResponseId: response.retryOfResponseId,
    retriedByResponseId: response.retriedByResponseId,
    reconnectAttempt: 0,
  };
  if (isActive(response.status)) {
    return { ...base, status: "streaming", text: "", streamClosed: false };
  }
  const assistant = messages.find((m) => m.id === response.assistantMessageId);
  const text = response.status === "completed" && assistant !== undefined ? assistant.content : response.partialText;
  return { ...base, status: response.status === "completed" ? "completed" : "failed", text, streamClosed: true };
}

/** A fresh, not-yet-streamed response (send/accepted and retry/accepted). */
function pendingResponse(
  id: ResponseId,
  userMessageId: MessageId,
  status: UiResponseStatus,
  retryOfResponseId: ResponseId | null,
): UiResponse {
  return {
    id,
    userMessageId,
    status,
    text: "",
    lastAppliedEventId: 0,
    streamClosed: false,
    failure: null,
    retryOfResponseId,
    retriedByResponseId: null,
    reconnectAttempt: 0,
  };
}

function applyStreamEvent(state: ChatState, event: StreamEvent): ChatState {
  const current = state.responses[event.data.responseId];
  // Rule 1 (AC-013, FR-007): a replayed or unknown event returns the SAME state reference.
  if (current === undefined || event.data.seq <= current.lastAppliedEventId) {
    return state;
  }
  const applied = { lastAppliedEventId: event.data.seq, reconnectAttempt: 0 };
  switch (event.type) {
    case "response.started": {
      const next: UiResponse = { ...current, ...applied, status: "streaming" };
      return {
        ...state,
        responses: withResponse(state, next),
        announcement: current.status === "streaming" ? state.announcement : statusAnnouncement("streaming"),
      };
    }
    case "response.delta": {
      // Rule 2 (AC-002): append in arrival order, which is seq order by rule 1.
      const next: UiResponse = { ...current, ...applied, status: "streaming", text: current.text + event.data.text };
      return {
        ...state,
        responses: withResponse(state, next),
        // Delta text never goes to a live region; only a status change is announced.
        announcement: current.status === "streaming" ? state.announcement : statusAnnouncement("streaming"),
      };
    }
    case "response.completed": {
      // Rule 3: authoritative full text (overwrite, not append); add the message only if absent.
      const next: UiResponse = {
        ...current,
        ...applied,
        status: "completed",
        text: event.data.assistantMessage.content,
        streamClosed: true,
      };
      return {
        ...state,
        responses: withResponse(state, next),
        messages: withMessage(state.messages, event.data.assistantMessage),
        announcement: statusAnnouncement("completed"),
      };
    }
    case "response.failed": {
      // Rule 4 (AC-016): keep the partial text.
      const next: UiResponse = {
        ...current,
        ...applied,
        status: "failed",
        failure: event.data.failure,
        streamClosed: true,
      };
      return {
        ...state,
        responses: withResponse(state, next),
        announcement: statusAnnouncement("failed", event.data.failure.message),
      };
    }
  }
}

function updateResponse(
  state: ChatState,
  responseId: ResponseId,
  change: (response: UiResponse) => UiResponse,
): ChatState["responses"] | null {
  const current = state.responses[responseId];
  return current === undefined ? null : withResponse(state, change(current));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "conversations/loading":
      return { ...state, conversationsLoad: { kind: "loading" } };

    case "conversations/loaded":
      return { ...state, conversations: [...action.conversations], conversationsLoad: { kind: "ready" } };

    case "conversations/failed":
      return {
        ...state,
        conversationsLoad: { kind: "error", error: action.error },
        lastError: action.error,
        announcement: errorAnnouncement(action.error),
      };

    case "conversation/selected":
      if (action.conversationId === state.selectedConversationId) {
        return state;
      }
      return {
        ...state,
        selectedConversationId: action.conversationId,
        conversationLoad: { kind: "idle" },
        messages: [],
        responses: {},
        draft: "",
        sending: false,
      };

    case "conversation/loading":
      return { ...state, conversationLoad: { kind: "loading" } };

    case "conversation/loaded": {
      const { detail } = action;
      if (detail.conversation.id !== state.selectedConversationId) {
        return state; // a stale load for a conversation no longer selected
      }
      const messages = bySeq(detail.messages);
      const responses: Record<string, UiResponse> = {};
      for (const response of detail.responses) {
        responses[response.id] = seedResponse(response, messages);
      }
      return { ...state, messages, responses, conversationLoad: { kind: "ready" } };
    }

    case "conversation/failed":
      return {
        ...state,
        conversationLoad: { kind: "error", error: action.error },
        lastError: action.error,
        announcement: errorAnnouncement(action.error),
      };

    case "conversation/created": {
      const { conversation } = action;
      const summary: ConversationSummary = {
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      };
      return {
        ...state,
        conversations: [summary, ...state.conversations.filter((c) => c.id !== conversation.id)],
        selectedConversationId: conversation.id,
        conversationLoad: { kind: "ready" },
        messages: [],
        responses: {},
        draft: "",
        sending: false,
      };
    }

    case "draft/changed":
      return { ...state, draft: action.draft };

    case "send/requested": {
      // Rule 5: an optimistic user message keyed by its clientMessageId.
      if (state.selectedConversationId === null) {
        return state;
      }
      const last = state.messages.at(-1);
      const optimistic: Message = {
        id: action.localMessageId,
        conversationId: state.selectedConversationId,
        seq: (last?.seq ?? 0) + 1,
        role: "user",
        content: action.content,
        clientMessageId: action.clientMessageId,
        createdAt: action.createdAt,
      };
      return {
        ...state,
        sending: true,
        lastError: null,
        messages: [...state.messages, optimistic],
        announcement: statusAnnouncement("sending"),
      };
    }

    case "send/accepted": {
      // Rule 5 (AC-008): replace the optimistic entry by clientMessageId with the server row;
      // a duplicate send that returns the original ids reconciles to exactly one message.
      const { userMessage, response } = action.accepted;
      if (userMessage.conversationId !== state.selectedConversationId) {
        return { ...state, sending: false };
      }
      const messages = bySeq([
        ...state.messages.filter(
          (m) => m.clientMessageId !== userMessage.clientMessageId && m.id !== userMessage.id,
        ),
        userMessage,
      ]);
      const responses =
        state.responses[response.id] === undefined
          ? withResponse(state, pendingResponse(response.id, response.userMessageId, "sending", null))
          : state.responses;
      return { ...state, messages, responses, sending: false, draft: "", lastError: null };
    }

    case "send/rejected":
      return {
        ...state,
        sending: false,
        messages: state.messages.filter((m) => m.clientMessageId !== action.clientMessageId),
        lastError: action.error,
        announcement: errorAnnouncement(action.error),
      };

    case "stream/opening":
      return state; // rule 7: opening leaves streamClosed false; nothing else changes

    case "stream/reconnecting": {
      // Rule 7: only while the stream is not closed and the response is still active.
      const current = state.responses[action.responseId];
      if (
        current === undefined ||
        current.streamClosed ||
        current.status === "completed" ||
        current.status === "failed"
      ) {
        return state;
      }
      return {
        ...state,
        responses: withResponse(state, {
          ...current,
          status: "reconnecting",
          reconnectAttempt: current.reconnectAttempt + 1,
        }),
        announcement: statusAnnouncement("reconnecting"),
      };
    }

    case "stream/event":
      return applyStreamEvent(state, action.event);

    case "stream/error": {
      // The stream ended with an error; it is not reopened automatically.
      const responses =
        updateResponse(state, action.responseId, (r) => ({ ...r, streamClosed: true })) ?? state.responses;
      return { ...state, responses, lastError: action.error, announcement: errorAnnouncement(action.error) };
    }

    case "stream/closed": {
      // Rule 7: a terminal close ends the stream for good; aborted/network change nothing here.
      if (action.reason !== "terminal") {
        return state;
      }
      const responses = updateResponse(state, action.responseId, (r) => ({ ...r, streamClosed: true }));
      return responses === null ? state : { ...state, responses };
    }

    case "retry/requested": {
      const responses = updateResponse(state, action.responseId, (r) => ({ ...r, status: "retrying" }));
      return responses === null
        ? state
        : { ...state, responses, lastError: null, announcement: statusAnnouncement("retrying") };
    }

    case "retry/accepted": {
      // AC-017: a repeated retry returns the same replacement; never a new user message.
      const { responseId, retryOfResponseId } = action.accepted;
      const original = state.responses[retryOfResponseId];
      if (original === undefined) {
        return state;
      }
      let responses = withResponse(state, { ...original, status: "failed", retriedByResponseId: responseId });
      if (responses[responseId] === undefined) {
        // Still "retrying" from the user's point of view until its stream delivers an event.
        responses = {
          ...responses,
          [responseId]: pendingResponse(responseId, original.userMessageId, "retrying", retryOfResponseId),
        };
      }
      return { ...state, responses, lastError: null };
    }

    case "retry/rejected": {
      const responses =
        updateResponse(state, action.responseId, (r) => ({ ...r, status: "failed" })) ?? state.responses;
      return { ...state, responses, lastError: action.error, announcement: errorAnnouncement(action.error) };
    }

    case "error/dismissed":
      return state.lastError === null ? state : { ...state, lastError: null };
  }
}
