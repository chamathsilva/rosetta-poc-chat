/**
 * Terminal-state predicates — packages/shared/src/domain-rules/terminal.ts.
 * SPECS §2.2 adoption #2 from Option C, §3.2. Re-exported/used by both the api
 * (apps/api/src/domain/response-machine.ts re-exports rather than duplicating)
 * and the web. Zero imports (no zod, no IO — SPECS §2.2).
 */
export type StreamEventType =
  | "response.started"
  | "response.delta"
  | "response.completed"
  | "response.failed";

export type ResponseStatus = "pending" | "streaming" | "completed" | "failed";

export function isTerminalEventType(type: StreamEventType): boolean {
  return type === "response.completed" || type === "response.failed";
}

export function isTerminalStatus(status: ResponseStatus): boolean {
  return status === "completed" || status === "failed";
}
