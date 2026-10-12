/**
 * Retry — apps/web/src/components/RetryButton.tsx. SPECS §4.5, §9.6 (FR-008,
 * AC-017, AC-018, AC-022). Described by the failure text it retries, and
 * disabled while that retry request is in flight (`status === "retrying"`).
 */
import type { ResponseId } from "@rosetta-poc/chat-shared";
import type { UiResponseStatus } from "../state/ui-status";
import { useChat } from "../state/ChatProvider";

export interface RetryButtonProps {
  readonly responseId: ResponseId;
  readonly status: UiResponseStatus;
}

export function failureTextId(responseId: ResponseId): string {
  return `failure-${responseId}`;
}

export function RetryButton({ responseId, status }: RetryButtonProps) {
  const { retry } = useChat();
  return (
    <button
      type="button"
      aria-describedby={failureTextId(responseId)}
      disabled={status === "retrying"}
      onClick={() => retry(responseId)}
    >
      Retry
    </button>
  );
}
