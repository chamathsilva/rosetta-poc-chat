/**
 * SPECS §3.2 (FR-004, AC-010): terminal = completed | failed, for both event
 * types and statuses; every other value is non-terminal.
 */
import { describe, expect, it } from "vitest";
import { isTerminalEventType, isTerminalStatus } from "./terminal.js";

describe("isTerminalEventType", () => {
  it.each([
    ["response.started", false],
    ["response.delta", false],
    ["response.completed", true],
    ["response.failed", true],
  ] as const)("%s ⇒ %s", (type, expected) => {
    expect(isTerminalEventType(type)).toBe(expected);
  });
});

describe("isTerminalStatus", () => {
  it.each([
    ["pending", false],
    ["streaming", false],
    ["completed", true],
    ["failed", true],
  ] as const)("%s ⇒ %s", (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});
