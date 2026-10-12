/**
 * SPECS §3.1, §10 (FR-010, AC-019, A-008, A-009): normalization is exactly
 * String.prototype.trim, length is counted in code points, and the check runs
 * after normalization.
 */
import { describe, expect, it } from "vitest";
import { MAX_CONTENT_CODE_POINTS, checkContent, codePointLength, normalizeContent } from "./normalize.js";

const EMOJI = "😀"; // one code point, two UTF-16 units

describe("normalizeContent", () => {
  it("trims ECMAScript WhiteSpace and LineTerminator at both ends only", () => {
    expect(normalizeContent("  hello  ")).toBe("hello");
    expect(normalizeContent("\n\t hello \r\n")).toBe("hello");
    expect(normalizeContent(" ﻿ hello 　")).toBe("hello");
  });

  it("preserves inner whitespace and case (A-008)", () => {
    expect(normalizeContent("  Hello  big\nWORLD  ")).toBe("Hello  big\nWORLD");
  });

  it("maps whitespace-only input to the empty string", () => {
    expect(normalizeContent("")).toBe("");
    expect(normalizeContent("   ")).toBe("");
    expect(normalizeContent("\n\t ")).toBe("");
  });
});

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("")).toBe(0);
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength(EMOJI)).toBe(1);
    expect(EMOJI.length).toBe(2);
    expect(codePointLength("a😀b世")).toBe(4);
  });
});

describe("checkContent (AC-019)", () => {
  it("the limit is exactly 4000 code points", () => {
    expect(MAX_CONTENT_CODE_POINTS).toBe(4000);
  });

  it.each([
    ["empty string", ""],
    ["three spaces, normalized", normalizeContent("   ")],
    ["newline/tab/space, normalized", normalizeContent("\n\t ")],
  ])("%s ⇒ empty", (_label, value) => {
    expect(checkContent(value)).toBe("empty");
  });

  it("exactly 4000 code points ⇒ ok", () => {
    expect(checkContent("x".repeat(4000))).toBe("ok");
  });

  it("4001 code points ⇒ too-long", () => {
    expect(checkContent("x".repeat(4001))).toBe("too-long");
  });

  it("4000 surrogate-pair code points (UTF-16 length 8000) ⇒ ok — proves code-point counting", () => {
    const value = EMOJI.repeat(4000);
    expect(value.length).toBe(8000);
    expect(checkContent(value)).toBe("ok");
  });

  it("4001 surrogate-pair code points ⇒ too-long", () => {
    expect(checkContent(EMOJI.repeat(4001))).toBe("too-long");
  });

  it("order is normalize → check: surrounding whitespace does not count toward the limit (A-009)", () => {
    const raw = `   ${"x".repeat(4000)}\n\t `;
    expect(codePointLength(raw)).toBeGreaterThan(4000);
    expect(checkContent(normalizeContent(raw))).toBe("ok");
  });

  it("§10 happy data ⇒ ok", () => {
    for (const raw of ["hello", "hello big world", "a  b\nc", "héllo 😀 世界"]) {
      expect(checkContent(normalizeContent(raw))).toBe("ok");
    }
  });
});
