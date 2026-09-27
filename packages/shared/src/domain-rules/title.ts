/**
 * Conversation title derivation — packages/shared/src/domain-rules/title.ts.
 * SPECS §3.3 (FR-001, FR-002, A-010, R8). Pure, zero imports — domain-rules/*
 * depends on nothing (SPECS §2), so code-point counting is self-contained
 * here rather than imported from ./normalize.ts.
 *
 * A conversation's title is written once (when its first user message is
 * inserted, same transaction) and never recomputed.
 */
export const MAX_TITLE_CODE_POINTS = 60;
export const PLACEHOLDER_TITLE = "New conversation";

/** Counts code points, not UTF-16 units — via Array.from, never .length. */
function titleCodePoints(value: string): string[] {
  return Array.from(value);
}

/**
 * Rule, exactly: null -> PLACEHOLDER_TITLE. Otherwise collapse every \s+ run
 * to a single U+0020, trim; if the result is empty -> PLACEHOLDER_TITLE; if
 * code-point length <= 60 -> the result; else the first 60 code points, no
 * ellipsis, no word-boundary logic.
 */
export function deriveConversationTitle(firstUserMessageContent: string | null): string {
  if (firstUserMessageContent === null) {
    return PLACEHOLDER_TITLE;
  }
  const collapsed = firstUserMessageContent.replace(/\s+/gu, " ").trim();
  if (collapsed === "") {
    return PLACEHOLDER_TITLE;
  }
  const codePoints = titleCodePoints(collapsed);
  if (codePoints.length <= MAX_TITLE_CODE_POINTS) {
    return collapsed;
  }
  return codePoints.slice(0, MAX_TITLE_CODE_POINTS).join("");
}
