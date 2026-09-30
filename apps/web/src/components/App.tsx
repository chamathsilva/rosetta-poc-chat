/**
 * App shell — apps/web/src/components/App.tsx. SPECS §9.5, §9.6 (FR-001,
 * FR-007, AC-002, AC-018, AC-022). Skip link, then `<nav aria-label=
 * "Conversations">`, then `<main>`; the two live regions are always mounted.
 *
 * The composer precedes the message list in both DOM and layout, so the tab
 * order is exactly the §9.6 contract — skip link → New conversation →
 * conversation buttons → textarea → Send → Retry — with no CSS reordering
 * that would split visual order from reading order.
 *
 * INC-09 has no stylesheet file, so the few required rules are rendered as
 * the text child of a `<style>` element (plain JSX text, not raw HTML).
 * `.sr-only` hides with clip/offset, never display:none (SPECS §9.6).
 */
import { useSelectedConversation } from "../hooks/useSelectedConversation";
import { useChat } from "../state/ChatProvider";
import { ConversationList } from "./ConversationList";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { StatusAnnouncer } from "./StatusAnnouncer";

export const APP_CSS = `
.sr-only, .sr-only-focusable:not(:focus) {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; }
body { font-family: system-ui, sans-serif; margin: 0; }
.app { display: grid; grid-template-columns: minmax(12rem, 18rem) 1fr; gap: 1rem; padding: 1rem; }
nav ul { list-style: none; padding: 0; }
button[aria-current="true"] { font-weight: 700; }
textarea { display: block; width: 100%; min-height: 4rem; }
`;

export function App() {
  useSelectedConversation();
  const { selectedConversationId } = useChat().state;

  return (
    <>
      <style>{APP_CSS}</style>
      <a href="#composer-input" className="sr-only-focusable">
        Skip to message input
      </a>
      <div className="app">
        <ConversationList />
        <main>
          <h1>Streaming chat</h1>
          <MessageComposer />
          {selectedConversationId === null ? <p>No conversation selected.</p> : <MessageList />}
        </main>
      </div>
      <StatusAnnouncer />
    </>
  );
}
