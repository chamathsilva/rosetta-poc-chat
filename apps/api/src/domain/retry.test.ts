/**
 * SPECS §3.4 (FR-008, AC-017, A-003). The check order is load-bearing:
 * (1) replacement ⇒ RETRY_NOT_ALLOWED; (2) existing replacement ⇒ existing;
 * (3) not failed ⇒ RESPONSE_NOT_FAILED; (4) start. The order-sensitive cases
 * below each have inputs where two rules apply, so a reordering fails a test.
 */
import { describe, expect, it } from "vitest";
import { classifyRetry } from "./retry.js";

describe("classifyRetry", () => {
  it("(4) a failed original with no replacement ⇒ start", () => {
    expect(classifyRetry({ status: "failed", retryOfResponseId: null }, null)).toEqual({ kind: "start" });
  });

  it("(2) a repeated retry returns the existing replacement (AC-017)", () => {
    expect(classifyRetry({ status: "failed", retryOfResponseId: null }, "r-2")).toEqual({ kind: "existing", responseId: "r-2" });
  });

  it.each(["pending", "streaming", "completed"] as const)("(3) a %s original ⇒ RESPONSE_NOT_FAILED", (status) => {
    expect(classifyRetry({ status, retryOfResponseId: null }, null)).toEqual({ kind: "rejected", code: "RESPONSE_NOT_FAILED" });
  });

  it("(1) a failed replacement is never retryable (A-003)", () => {
    expect(classifyRetry({ status: "failed", retryOfResponseId: "r-1" }, null)).toEqual({ kind: "rejected", code: "RETRY_NOT_ALLOWED" });
  });

  it("order (1) before (2): a replacement that somehow has a replacement ⇒ RETRY_NOT_ALLOWED, not existing", () => {
    expect(classifyRetry({ status: "failed", retryOfResponseId: "r-1" }, "r-3")).toEqual({ kind: "rejected", code: "RETRY_NOT_ALLOWED" });
  });

  it("order (1) before (3): a non-failed replacement ⇒ RETRY_NOT_ALLOWED, not RESPONSE_NOT_FAILED", () => {
    expect(classifyRetry({ status: "completed", retryOfResponseId: "r-1" }, null)).toEqual({ kind: "rejected", code: "RETRY_NOT_ALLOWED" });
  });

  it("order (2) before (3): an original that already has a replacement returns it, whatever its own status", () => {
    expect(classifyRetry({ status: "completed", retryOfResponseId: null }, "r-2")).toEqual({ kind: "existing", responseId: "r-2" });
  });
});
