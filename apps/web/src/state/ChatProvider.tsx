/**
 * Chat provider — apps/web/src/state/ChatProvider.tsx. SPECS §9.3, §9.4,
 * §9.5, §9.6 (FR-001, FR-002, FR-007, FR-008, AC-002, AC-008, AC-013, AC-018,
 * AC-022). Context + dispatch + effect orchestration: every IO call and timer
 * lives here or in the two hooks; chatReducer stays the only place state
 * changes.
 *
 * INC-08 carry-forward: `conversation/loaded` re-seeds every response (§9.4
 * rule 6), so a conversation is loaded only when the selection changes —
 * never while it is already selected with a stream open. A selection change
 * empties `responses` first, which closes the old streams before the new load
 * re-seeds from 0.
 */
import {
  messageIdSchema,
  type ConversationId,
  type ResponseId,
} from "@rosetta-poc/chat-shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createHttpClient, type HttpClient } from "../api/http-client";
import { webConfig } from "../config/env";
import { useResponseStream } from "../hooks/useResponseStream";
import { chatReducer, initialChatState, type ChatState } from "./chat-reducer";

export interface ChatContextValue {
  readonly state: ChatState;
  /** Incremented whenever focus must move to #composer-input (§9.6 focus contract). */
  readonly composerFocusRequest: number;
  createConversation(): void;
  selectConversation(conversationId: ConversationId | null): void;
  setDraft(draft: string): void;
  sendDraft(): void;
  retry(responseId: ResponseId): void;
  dismissError(): void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * True while any response is not yet completed or failed. Mirrors the server's
 * one-active-response-per-conversation invariant (§3.4a/§5.2): Send stays
 * disabled, and Enter-to-submit is refused, while this holds (§9.6).
 */
export function hasActiveResponse(state: ChatState): boolean {
  return Object.values(state.responses).some(
    (response) => response.status !== "completed" && response.status !== "failed",
  );
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used inside <ChatProvider>");
  }
  return value;
}

export interface ChatProviderProps {
  readonly children: ReactNode;
  /** Defaults to VITE_API_BASE_URL (SPECS §7.2). */
  readonly baseUrl?: string;
}

export function ChatProvider({ children, baseUrl = webConfig.apiBaseUrl }: ChatProviderProps) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const client: HttpClient = useMemo(() => createHttpClient(baseUrl), [baseUrl]);

  // Latest state for async continuations (stale-result guards, idempotency key reuse).
  const stateRef = useRef(state);
  stateRef.current = state;
  // The selection most recently requested, updated synchronously (stateRef lags until the next
  // render, and StrictMode runs mount effects twice): it decides whether a load is needed.
  const selectionRef = useRef<ConversationId | null>(null);
  // Bumped on every selection change (select, NOT_FOUND deselect, create). A send, retry or load
  // result is dispatched only if the generation is unchanged since its request, so a late result
  // can never land in another conversation — including A → B → A, where the ids match again.
  const generationRef = useRef(0);
  // Per conversation: a send that failed on the network keeps its clientMessageId, so pressing
  // Send again with the same text there is an idempotent replay, never a second message
  // (FR-009, AC-008). Another conversation never reuses it.
  const pendingSendsRef = useRef(new Map<ConversationId, { content: string; clientMessageId: string }>());

  const changeSelection = useCallback((conversationId: ConversationId | null): number => {
    selectionRef.current = conversationId;
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  useResponseStream(baseUrl, state, dispatch);

  const requestComposerFocus = useCallback(() => {
    setComposerFocusRequest((n) => n + 1);
  }, []);

  const loadConversations = useCallback(async () => {
    dispatch({ type: "conversations/loading" });
    const result = await client.listConversations();
    dispatch(
      result.ok
        ? { type: "conversations/loaded", conversations: result.value.conversations }
        : { type: "conversations/failed", error: result.error },
    );
  }, [client]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const selectConversation = useCallback(
    (conversationId: ConversationId | null) => {
      if (conversationId === selectionRef.current) {
        return; // never reload the selected conversation (INC-08 note)
      }
      const generation = changeSelection(conversationId);
      dispatch({ type: "conversation/selected", conversationId });
      if (conversationId === null) {
        return;
      }
      dispatch({ type: "conversation/loading" });
      void client.getConversation(conversationId).then((result) => {
        if (generationRef.current !== generation) {
          return; // the selection changed since this load began (A → B → A included)
        }
        if (result.ok) {
          dispatch({ type: "conversation/loaded", detail: result.value });
        } else if (result.error.code === "NOT_FOUND") {
          changeSelection(null);
          dispatch({ type: "conversation/selected", conversationId: null }); // §9.5: empty state
        } else {
          dispatch({ type: "conversation/failed", error: result.error });
        }
      });
    },
    [client, changeSelection],
  );

  const createConversation = useCallback(() => {
    void client.createConversation().then((result) => {
      if (result.ok) {
        changeSelection(result.value.conversation.id); // created ⇒ selected (reducer)
        dispatch({ type: "conversation/created", conversation: result.value.conversation });
        requestComposerFocus();
      } else {
        dispatch({ type: "conversation/failed", error: result.error });
      }
    });
  }, [client, changeSelection, requestComposerFocus]);

  const setDraft = useCallback((draft: string) => {
    dispatch({ type: "draft/changed", draft });
  }, []);

  const sendDraft = useCallback(() => {
    const { selectedConversationId, draft, sending } = stateRef.current;
    if (selectedConversationId === null || sending || hasActiveResponse(stateRef.current)) {
      return;
    }
    const conversationId = selectedConversationId;
    const generation = generationRef.current;
    const pendingSends = pendingSendsRef.current;
    const pending = pendingSends.get(conversationId);
    const clientMessageId =
      pending !== undefined && pending.content === draft ? pending.clientMessageId : crypto.randomUUID();
    pendingSends.set(conversationId, { content: draft, clientMessageId });
    dispatch({
      type: "send/requested",
      clientMessageId,
      content: draft,
      localMessageId: messageIdSchema.parse(crypto.randomUUID()),
      createdAt: new Date().toISOString(),
    });
    void client.sendMessage(conversationId, { clientMessageId, content: draft }).then((result) => {
      // Key bookkeeping describes the server-side send, so it happens even when the UI moved on.
      if (result.ok || result.error.kind !== "network") {
        if (pendingSends.get(conversationId)?.clientMessageId === clientMessageId) {
          pendingSends.delete(conversationId);
        }
      }
      if (result.ok) {
        void loadConversations(); // title and list order change with the first message
      }
      if (generationRef.current !== generation) {
        return; // another conversation is on screen now: never show this result there
      }
      dispatch(
        result.ok
          ? { type: "send/accepted", accepted: result.value }
          : { type: "send/rejected", clientMessageId, error: result.error },
      );
    });
  }, [client, loadConversations]);

  const retry = useCallback(
    (responseId: ResponseId) => {
      const generation = generationRef.current;
      dispatch({ type: "retry/requested", responseId });
      void client.retryResponse(responseId).then((result) => {
        if (generationRef.current !== generation) {
          return; // the retried response's conversation is no longer on screen
        }
        if (result.ok) {
          dispatch({ type: "retry/accepted", accepted: result.value });
          requestComposerFocus(); // the Retry button unmounts (§9.6)
        } else {
          dispatch({ type: "retry/rejected", responseId, error: result.error });
        }
      });
    },
    [client, requestComposerFocus],
  );

  const dismissError = useCallback(() => {
    dispatch({ type: "error/dismissed" });
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      state,
      composerFocusRequest,
      createConversation,
      selectConversation,
      setDraft,
      sendDraft,
      retry,
      dismissError,
    }),
    [state, composerFocusRequest, createConversation, selectConversation, setDraft, sendDraft, retry, dismissError],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
