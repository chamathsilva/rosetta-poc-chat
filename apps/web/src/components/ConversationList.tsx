/**
 * Conversation list — apps/web/src/components/ConversationList.tsx. SPECS
 * §9.6 (FR-001, AC-002, AC-022). `<nav aria-label="Conversations">` › New
 * conversation › `<ul>` › `<li>` › one button per conversation, the selected
 * one marked `aria-current="true"`. Titles are JSX text (AC-020).
 */
import { useChat } from "../state/ChatProvider";

export function ConversationList() {
  const { state, createConversation, selectConversation } = useChat();
  const { conversations, conversationsLoad, selectedConversationId } = state;

  return (
    <nav aria-label="Conversations">
      <button type="button" onClick={createConversation}>
        New conversation
      </button>
      {conversationsLoad.kind === "loading" && conversations.length === 0 ? <p>Loading conversations…</p> : null}
      {conversationsLoad.kind === "ready" && conversations.length === 0 ? <p>No conversations yet.</p> : null}
      <ul>
        {conversations.map((conversation) => {
          const selected = conversation.id === selectedConversationId;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => selectConversation(conversation.id)}
              >
                {conversation.title}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
