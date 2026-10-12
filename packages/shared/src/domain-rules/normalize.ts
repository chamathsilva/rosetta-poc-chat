/**
 * Content normalization and limits — packages/shared/src/domain-rules/normalize.ts.
 * SPECS §3.1 (FR-010, AC-019, A-008, A-009). Zero imports (domain-rules/* imports
 * nothing — SPECS §2.2 dependency rule).
 *
 * Order is fixed: normalize -> checkContent -> persist.
 */
export const MAX_CONTENT_CODE_POINTS = 4000;

/** Exactly String.prototype.trim (ECMAScript WhiteSpace + LineTerminator). */
export function normalizeContent(raw: string): string {
  return raw.trim();
}

/** Counts code points, not UTF-16 units — via Array.from, never .length. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export type ContentCheck = "ok" | "empty" | "too-long";

export function checkContent(normalized: string): ContentCheck {
  if (normalized === "") {
    return "empty";
  }
  if (codePointLength(normalized) > MAX_CONTENT_CODE_POINTS) {
    return "too-long";
  }
  return "ok";
}
