/**
 * SPECS §4.1, §6.3 (FR-005, FR-010, AC-012, AC-019, R4).
 *
 * The five-row Last-Event-ID table. parseLastEventId owns rows 1–3 and 5; row 4
 * (value > maxSeq ⇒ 400 LAST_EVENT_ID_OUT_OF_RANGE) needs the response's maxSeq,
 * so the parser returns `ok` and the route makes that decision — asserted here
 * at the parser boundary and over the real route in INC-12.
 */
import { describe, expect, it } from "vitest";
import { conversationParamsSchema, parseLastEventId, responseParamsSchema } from "./params.js";

const UUID = "3f2b8c1e-5d4a-4c6b-9e7f-0a1b2c3d4e5f";

describe("parseLastEventId — AC-012 five-row table", () => {
  it("row 1: header absent ⇒ ok 0 (full replay)", () => {
    expect(parseLastEventId(undefined)).toEqual({ kind: "ok", value: 0 });
  });

  it.each(["", " ", "   ", "\t", "\n \t"])("row 2: empty or whitespace-only %j ⇒ ok 0 (empty ≡ absent, R4)", (header) => {
    expect(parseLastEventId(header)).toEqual({ kind: "ok", value: 0 });
  });

  it.each(["abc", "-1", "1.5", "1e3", "1234567890123456", "12345678901234567890", "+1", "0x10", "1 2", "١٢", "５"])(
    "row 3: not ^\\d{1,15}$ after trim %j ⇒ malformed (400 INVALID_LAST_EVENT_ID)",
    (header) => {
      expect(parseLastEventId(header)).toEqual({ kind: "malformed" });
    },
  );

  it("row 4: digits above maxSeq still parse ok — the out-of-range 400 is the route's decision", () => {
    expect(parseLastEventId("999")).toEqual({ kind: "ok", value: 999 });
  });

  it.each([
    ["0", 0],
    ["7", 7],
    ["42", 42],
  ])("row 5: digits %j ⇒ ok %d", (header, value) => {
    expect(parseLastEventId(header)).toEqual({ kind: "ok", value });
  });

  it("leading zeros parse decimally: '007' ⇒ 7", () => {
    expect(parseLastEventId("007")).toEqual({ kind: "ok", value: 7 });
  });

  it("surrounding whitespace is trimmed before the pattern check", () => {
    expect(parseLastEventId("  12\t")).toEqual({ kind: "ok", value: 12 });
  });

  it("boundary: 15 digits ⇒ ok, 16 digits ⇒ malformed", () => {
    expect(parseLastEventId("999999999999999")).toEqual({ kind: "ok", value: 999999999999999 });
    expect(parseLastEventId("0000000000000001")).toEqual({ kind: "malformed" });
  });
});

describe("path param schemas (AC-019 invalid identifier)", () => {
  it("accept a UUID", () => {
    expect(conversationParamsSchema.parse({ conversationId: UUID })).toEqual({ conversationId: UUID });
    expect(responseParamsSchema.parse({ responseId: UUID })).toEqual({ responseId: UUID });
  });

  it.each(["not-a-uuid", "", "3f2b8c1e5d4a4c6b9e7f0a1b2c3d4e5f", `${UUID}0`])("reject non-UUID %j", (id) => {
    expect(conversationParamsSchema.safeParse({ conversationId: id }).success).toBe(false);
    expect(responseParamsSchema.safeParse({ responseId: id }).success).toBe(false);
  });

  it("are strict: an extra key is rejected", () => {
    expect(conversationParamsSchema.safeParse({ conversationId: UUID, extra: "1" }).success).toBe(false);
    expect(responseParamsSchema.safeParse({ responseId: UUID, extra: "1" }).success).toBe(false);
  });
});
