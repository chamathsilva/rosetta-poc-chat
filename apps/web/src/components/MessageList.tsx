/**
 * Message list — apps/web/src/components/MessageList.tsx. SPECS §9.1, §9.6
 * (FR-001, FR-008, AC-002, AC-016, AC-018, AC-020).
 *
 * `<ol aria-label="Messages">` › one `<li>` per `messages` entry (seq order),
 * plus one `<li>` for each response that has no assistant message yet —
 * placed right after its user message. Assistant text comes from
 * `UiResponse.text` while streaming and from the assistant `Message` once
 * completed. Every status renders its own visible text (FR-001). All user and
 * provider text is a JSX text child (AC-020). No live region here.
 */
import type { Message } from "@rosetta-poc/chat-shared";
import type { UiResponse } from "../state/chat-reducer";
import { useChat } from "../state/ChatProvider";
import type { UiResponseStatus } from "../state/ui-status";
import { failureTextId, RetryButton } from "./RetryButton";

/** Six distinct visible labels, one per status (FR-001, §9.1). */
export const STATUS_LABEL: Readonly<Record<UiResponseStatus, string>> = {
  sending: "Sending…",
  streaming: "Responding…",
  completed: "Response complete",
  failed: "Response failed",
  reconnecting: "Reconnecting…",
  retrying: "Retrying…",
};

function UserItem({ message }: { readonly message: Message }) {
  return (
    <li>
      <article aria-label="You said">
        <p className="message-text">{message.content}</p>
      </article>
    </li>
  );
}

function AssistantMessageItem({ message }: { readonly message: Message }) {
  return (
    <li>
      <article aria-label="Assistant said">
        <p className="message-text">{message.content}</p>
        <p className="message-status">{STATUS_LABEL.completed}</p>
      </article>
    </li>
  );
}

/** A response still streaming, reconnecting, retrying, or failed (no assistant message yet). */
function ResponseItem({ response }: { readonly response: UiResponse }) {
  // A replacement is never retryable (A-003); a retried original shows no second Retry.
  const retryable =
    (response.status === "failed" || response.status === "retrying") &&
    response.retryOfResponseId === null &&
    response.retriedByResponseId === null;
  return (
    <li>
      <article aria-label="Assistant said">
        {response.text === "" ? null : <p className="message-text">{response.text}</p>}
        <p className="message-status">{STATUS_LABEL[response.status]}</p>
        {response.failure === null ? null : (
          <p id={failureTextId(response.id)} className="message-failure">
            {response.failure.message}
          </p>
        )}
        {retryable ? <RetryButton responseId={response.id} status={response.status} /> : null}
      </article>
    </li>
  );
}

export function MessageList() {
  const { messages, responses, conversationLoad } = useChat().state;
  const pending = Object.values(responses).filter((response) => response.status !== "completed");
  // Original before its replacement.
  pending.sort((a, b) => (a.retryOfResponseId === null ? 0 : 1) - (b.retryOfResponseId === null ? 0 : 1));

  if (conversationLoad.kind === "loading" && messages.length === 0) {
    return <p>Loading conversation…</p>;
  }

  return (
    <ol aria-label="Messages">
      {messages.flatMap((message) => {
        if (message.role === "assistant") {
          return [<AssistantMessageItem key={message.id} message={message} />];
        }
        return [
          <UserItem key={message.id} message={message} />,
          ...pending
            .filter((response) => response.userMessageId === message.id)
            .map((response) => <ResponseItem key={response.id} response={response} />),
        ];
      })}
    </ol>
  );
}
