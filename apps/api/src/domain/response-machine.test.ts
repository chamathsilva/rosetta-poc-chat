/**
 * SPECS §3.2 (FR-004, AC-010, AC-014, R6). Expected outcomes are written out
 * independently for every status pair and every append case.
 */
import { describe, expect, it } from "vitest";
import {
  checkAppend,
  checkTransition,
  isActiveStatus,
  isTerminalEventType,
  isTerminalStatus,
  nextSeq,
  type ResponseStatus,
  type StreamEventType,
} from "./response-machine.js";

describe("status predicates", () => {
  it.each([
    ["pending", true, false],
    ["streaming", true, false],
    ["completed", false, true],
    ["failed", false, true],
  ] as const)("%s: active=%s terminal=%s (R6)", (status, active, terminal) => {
    expect(isActiveStatus(status)).toBe(active);
    expect(isTerminalStatus(status)).toBe(terminal);
  });

  it("re-exports the shared terminal event predicate", () => {
    expect(isTerminalEventType("response.completed")).toBe(true);
    expect(isTerminalEventType("response.delta")).toBe(false);
  });
});

describe("nextSeq: maxSeq + 1, first = 1", () => {
  it.each([
    [0, 1],
    [1, 2],
    [41, 42],
  ])("nextSeq(%d) = %d", (maxSeq, expected) => {
    expect(nextSeq(maxSeq)).toBe(expected);
  });
});

describe("checkTransition — all 16 pairs", () => {
  const table: ReadonlyArray<readonly [ResponseStatus, ResponseStatus, string]> = [
    ["pending", "pending", "illegal-transition"],
    ["pending", "streaming", "ok"],
    ["pending", "completed", "illegal-transition"],
    ["pending", "failed", "ok"],
    ["streaming", "pending", "illegal-transition"],
    ["streaming", "streaming", "illegal-transition"],
    ["streaming", "completed", "ok"],
    ["streaming", "failed", "ok"],
    ["completed", "pending", "already-terminal"],
    ["completed", "streaming", "already-terminal"],
    ["completed", "completed", "already-terminal"],
    ["completed", "failed", "already-terminal"],
    ["failed", "pending", "already-terminal"],
    ["failed", "streaming", "already-terminal"],
    ["failed", "completed", "already-terminal"],
    ["failed", "failed", "already-terminal"],
  ];
  it.each(table)("%s → %s ⇒ %s", (from, to, expected) => {
    expect(checkTransition(from, to)).toBe(expected);
  });
});

describe("checkAppend (AC-010)", () => {
  const S = "response.started";
  const D = "response.delta";
  const C = "response.completed";
  const F = "response.failed";
  const table: ReadonlyArray<readonly [string, ResponseStatus, readonly StreamEventType[], StreamEventType, string]> = [
    ["seq 1 must be started", "pending", [], S, "ok"],
    ["seq 1 cannot be a delta", "pending", [], D, "must-start-first"],
    ["seq 1 cannot be completed", "pending", [], C, "must-start-first"],
    ["seq 1 cannot be failed", "pending", [], F, "must-start-first"],
    ["a second started is rejected", "streaming", [S], S, "already-started"],
    ["a second started after deltas is rejected", "streaming", [S, D], S, "already-started"],
    ["delta while streaming", "streaming", [S], D, "ok"],
    ["delta while still pending", "pending", [S], D, "not-streaming"],
    ["delta after completion", "completed", [S, C], D, "not-streaming"],
    ["completed while streaming", "streaming", [S, D], C, "ok"],
    ["failed while streaming", "streaming", [S, D], F, "ok"],
    ["failed right after started while pending (recovery zero-event branch, §5.6)", "pending", [S], F, "ok"],
    ["second terminal: completed then failed", "completed", [S, C], F, "terminal-exists"],
    ["second terminal: failed then completed", "failed", [S, F], C, "terminal-exists"],
    ["second terminal: failed then failed", "failed", [S, D, F], F, "terminal-exists"],
  ];
  it.each(table)("%s", (_label, status, existing, next, expected) => {
    expect(checkAppend(status, existing, next)).toBe(expected);
  });
});
