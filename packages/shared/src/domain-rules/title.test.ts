/**
 * SPECS §3.3 (FR-001, FR-002, A-010, R8): null or blank ⇒ placeholder; collapse
 * every \s+ run to one space and trim; keep the first 60 code points with no
 * ellipsis and no word-boundary logic.
 */
import { describe, expect, it } from "vitest";
import { MAX_TITLE_CODE_POINTS, PLACEHOLDER_TITLE, deriveConversationTitle } from "./title.js";

describe("deriveConversationTitle", () => {
  it("constants are fixed", () => {
    expect(MAX_TITLE_CODE_POINTS).toBe(60);
    expect(PLACEHOLDER_TITLE).toBe("New conversation");
  });

  it("null ⇒ placeholder", () => {
    expect(deriveConversationTitle(null)).toBe("New conversation");
  });

  it.each(["", "   ", "\n\t \r\n"])("blank %j ⇒ placeholder", (value) => {
    expect(deriveConversationTitle(value)).toBe("New conversation");
  });

  it("collapses whitespace runs to a single space and trims", () => {
    expect(deriveConversationTitle("  Hello \n\n  big\tworld  ")).toBe("Hello big world");
  });

  it("≤ 60 code points is returned whole", () => {
    const sixty = "a".repeat(60);
    expect(deriveConversationTitle(sixty)).toBe(sixty);
  });

  it("61 code points ⇒ the first 60, no ellipsis", () => {
    expect(deriveConversationTitle(`${"a".repeat(60)}b`)).toBe("a".repeat(60));
  });

  it("truncation cuts mid-word (no word-boundary logic)", () => {
    const words = "abcdefghij ".repeat(6); // 65 code points after trim
    const expected = "abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcde"; // 60, mid-word
    expect(expected.length).toBe(60);
    expect(deriveConversationTitle(words)).toBe(expected);
  });

  it("counts code points: 61 emoji ⇒ exactly 60 emoji (120 UTF-16 units)", () => {
    const title = deriveConversationTitle("😀".repeat(61));
    expect(title).toBe("😀".repeat(60));
    expect(title.length).toBe(120);
  });

  it("collapsing happens before the 60-code-point cut", () => {
    const raw = `${"a".repeat(30)}${" ".repeat(50)}${"b".repeat(40)}`;
    expect(deriveConversationTitle(raw)).toBe(`${"a".repeat(30)} ${"b".repeat(29)}`);
  });
});
