/**
 * Composer — apps/web/src/components/MessageComposer.tsx. SPECS §9.2, §9.6
 * (FR-001, FR-002, AC-002, AC-018, AC-022).
 *
 * `<form>` › visible label › `<textarea id="composer-input">` › Send. Send is
 * disabled while a send is in flight or any response is still active
 * (§3.4a/§5.2 one-active-response invariant). Enter submits, Shift+Enter
 * inserts a newline. Focus moves here after a conversation is created and
 * after a retry is accepted; after a successful send it stays here and the
 * draft is cleared.
 *
 * `#composer-error` shows the last error with its one next action (§9.2,
 * AC-018): fix-input (edit the text), retry-send (press Send again — the same
 * clientMessageId is reused), retry-response (the Retry button on the failed
 * response), reload (the Reload button).
 */
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { hasActiveResponse, useChat } from "../state/ChatProvider";
import type { UiError, UiErrorKind, UiNextAction } from "../state/ui-status";

const KIND_LABEL: Readonly<Record<UiErrorKind, string>> = {
  validation: "Message not sent.",
  network: "Network error.",
  server: "Server error.",
  provider: "Response failed.",
};

const ACTION_HINT: Readonly<Record<UiNextAction, string>> = {
  "fix-input": "Edit your message and send it again.",
  "retry-send": "Press Send to try again.",
  "retry-response": "Use Retry on the failed response.",
  reload: "Reload the page.",
};

function ErrorText({ error }: { readonly error: UiError }) {
  return (
    <>
      {KIND_LABEL[error.kind]} {error.message} {ACTION_HINT[error.nextAction]}
    </>
  );
}

export function MessageComposer() {
  const { state, composerFocusRequest, setDraft, sendDraft } = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const noConversation = state.selectedConversationId === null;
  const busy = state.sending || hasActiveResponse(state);
  const error = state.lastError;
  const hasError = error !== null && error.kind === "validation";

  // Focus requests arrive after the render that enables the textarea.
  useEffect(() => {
    if (composerFocusRequest > 0) {
      inputRef.current?.focus();
    }
  }, [composerFocusRequest]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!busy && !noConversation) {
      sendDraft();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="composer-input">Message</label>
      <textarea
        id="composer-input"
        ref={inputRef}
        required
        aria-describedby="composer-help composer-error"
        aria-invalid={hasError}
        disabled={noConversation}
        value={state.draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p id="composer-help">
        {noConversation
          ? "Create or select a conversation first."
          : "Enter sends the message. Shift+Enter adds a new line."}
      </p>
      <p id="composer-error" data-error-kind={error === null ? undefined : error.kind}>
        {error === null ? null : <ErrorText error={error} />}
      </p>
      <button type="submit" disabled={busy || noConversation}>
        Send
      </button>
      {error !== null && error.nextAction === "reload" ? (
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      ) : null}
    </form>
  );
}
