/**
 * Selection ↔ URL — apps/web/src/hooks/useSelectedConversation.ts. SPECS §9.5
 * (FR-007, AC-013). The selected conversation lives in the URL as
 * `?c=<conversationId>`: read once on mount, written with
 * history.replaceState on every later selection change (no router). An
 * invalid id clears the parameter; an unknown id is deselected by the
 * provider after its load returns NOT_FOUND, which clears it here. This is
 * what makes a refresh restore the selection.
 */
import { conversationIdSchema, type ConversationId } from "@rosetta-poc/chat-shared";
import { useEffect, useRef } from "react";
import { useChat } from "../state/ChatProvider";

export const SELECTION_PARAM = "c";

function writeSelection(conversationId: ConversationId | null): void {
  const url = new URL(window.location.href);
  if (conversationId === null) {
    url.searchParams.delete(SELECTION_PARAM);
  } else {
    url.searchParams.set(SELECTION_PARAM, conversationId);
  }
  window.history.replaceState(window.history.state, "", url);
}

export function useSelectedConversation(): void {
  const { state, selectConversation } = useChat();
  const selected = state.selectedConversationId;
  const previousRef = useRef<ConversationId | null>(selected);

  // Mount: parse, validate, then select (the provider loads it).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(SELECTION_PARAM);
    if (raw === null) {
      return;
    }
    const parsed = conversationIdSchema.safeParse(raw);
    if (parsed.success) {
      selectConversation(parsed.data);
    } else {
      writeSelection(null);
    }
  }, [selectConversation]);

  // Every later change (including the provider's NOT_FOUND deselect) is written to the URL.
  useEffect(() => {
    if (previousRef.current === selected) {
      return;
    }
    previousRef.current = selected;
    writeSelection(selected);
  }, [selected]);
}
