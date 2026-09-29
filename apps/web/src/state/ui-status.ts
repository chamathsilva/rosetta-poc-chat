/**
 * UI status and error vocabulary — apps/web/src/state/ui-status.ts. SPECS
 * §9.1, §9.6 (FR-001, AC-018). Six distinct response statuses, four error
 * kinds, each error carrying exactly one next action, and the fixed
 * announcement text table read by StatusAnnouncer.
 */

export type UiResponseStatus =
  | "sending"
  | "streaming"
  | "completed"
  | "failed"
  | "reconnecting"
  | "retrying";

export type UiErrorKind = "network" | "server" | "validation" | "provider";

export type UiNextAction = "retry-send" | "retry-response" | "reload" | "fix-input";

export interface UiError {
  readonly kind: UiErrorKind;
  readonly code: string;
  readonly message: string;
  readonly nextAction: UiNextAction;
}

export interface Announcement {
  readonly politeness: "polite" | "assertive";
  readonly text: string;
}

/** Progress announcements (polite live region) — SPECS §9.6. */
const STATUS_TEXT: Readonly<Record<Exclude<UiResponseStatus, "failed">, string>> = {
  sending: "Sending message.",
  streaming: "Assistant is responding.",
  completed: "Assistant response complete.",
  reconnecting: "Connection lost. Reconnecting.",
  retrying: "Retrying response.",
};

/** Error prefixes (assertive alert region) — SPECS §9.6. */
const ERROR_PREFIX: Readonly<Record<UiErrorKind, string>> = {
  validation: "Message not sent.",
  network: "Network error.",
  server: "Server error.",
  provider: "Response failed.",
};

export function statusAnnouncement(
  status: UiResponseStatus,
  failureMessage: string | null = null,
): Announcement {
  if (status === "failed") {
    return { politeness: "assertive", text: `Response failed. ${failureMessage ?? ""}`.trim() };
  }
  return { politeness: "polite", text: STATUS_TEXT[status] };
}

export function errorAnnouncement(error: UiError): Announcement {
  return { politeness: "assertive", text: `${ERROR_PREFIX[error.kind]} ${error.message}` };
}
