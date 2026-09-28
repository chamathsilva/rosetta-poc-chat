/**
 * Response state machine — apps/api/src/domain/response-machine.ts.
 * SPECS §3.2 (FR-004, AC-010, R6), §2.2 terminal-once. PURE: no IO, no zod.
 *
 * The DB partial unique index ux_stream_events_terminal is the hard
 * terminal-once invariant; this module is the friendly guard in front of it.
 * isTerminalEventType / isTerminalStatus are re-exported from shared
 * domain-rules/terminal.ts rather than duplicated (adoption #2 from Option C).
 */
import { isTerminalEventType, isTerminalStatus } from "@rosetta-poc/chat-shared";
import type { ResponseStatus, StreamEventType } from "./types.js";

export { isTerminalEventType, isTerminalStatus };
export type { ResponseStatus, StreamEventType };

/** R6 finalized: active = pending | streaming. */
export function isActiveStatus(s: ResponseStatus): boolean {
  return s === "pending" || s === "streaming";
}

/** Per-response event seq: maxSeq + 1, first = 1 (FR-004, AC-010). */
export function nextSeq(maxSeq: number): number {
  return maxSeq + 1;
}

export type TransitionCheck = "ok" | "illegal-transition" | "already-terminal";

/**
 * Legal transitions, exhaustively: pending→streaming, pending→failed,
 * streaming→completed, streaming→failed (AC-010, AC-014).
 */
export function checkTransition(from: ResponseStatus, to: ResponseStatus): TransitionCheck {
  if (isTerminalStatus(from)) {
    return "already-terminal";
  }
  if (from === "pending" && (to === "streaming" || to === "failed")) {
    return "ok";
  }
  if (from === "streaming" && (to === "completed" || to === "failed")) {
    return "ok";
  }
  return "illegal-transition";
}

export type AppendCheck =
  | "ok"
  | "must-start-first"
  | "already-started"
  | "terminal-exists"
  | "not-streaming";

/**
 * AC-010: seq 1 must be response.started and it may appear exactly once; a
 * terminal type is rejected when a terminal type already exists;
 * response.delta requires status "streaming".
 */
export function checkAppend(
  status: ResponseStatus,
  existingTypes: readonly StreamEventType[],
  next: StreamEventType,
): AppendCheck {
  if (existingTypes.length === 0 && next !== "response.started") {
    return "must-start-first";
  }
  if (next === "response.started" && existingTypes.includes("response.started")) {
    return "already-started";
  }
  if (isTerminalEventType(next) && existingTypes.some(isTerminalEventType)) {
    return "terminal-exists";
  }
  if (next === "response.delta" && status !== "streaming") {
    return "not-streaming";
  }
  return "ok";
}
