/**
 * SPECS §3.4, §3.4a (FR-009, AC-008, AC-009; one-active-response gate).
 */
import { describe, expect, it } from "vitest";
import { checkActiveResponseGate, classifySend, type ExistingSend } from "./idempotency.js";

const existing: ExistingSend = { userMessageId: "m-1", responseId: "r-1", normalizedContent: "hello  world" };

describe("classifySend", () => {
  it("no existing send under the key ⇒ new", () => {
    expect(classifySend(null, "hello")).toEqual({ kind: "new" });
  });

  it("same key + byte-identical normalized content ⇒ duplicate with the ORIGINAL ids (AC-008)", () => {
    expect(classifySend(existing, "hello  world")).toEqual({ kind: "duplicate", userMessageId: "m-1", responseId: "r-1" });
  });

  it.each([
    ["different text", "goodbye"],
    ["inner whitespace differs", "hello world"],
    ["case differs", "Hello  world"],
    ["trailing whitespace is not re-normalized here", "hello  world "],
  ])("same key + %s ⇒ conflict (AC-009)", (_label, incoming) => {
    expect(classifySend(existing, incoming)).toEqual({ kind: "conflict" });
  });

  it("same key + the same accented text in another Unicode normalization form ⇒ conflict (byte-identical only, no Unicode normalization)", () => {
    const nfc = "café crème".normalize("NFC");
    const nfd = "café crème".normalize("NFD");
    expect(nfd).not.toBe(nfc); // the fixtures really differ in code units/bytes
    expect(nfd.length).toBeGreaterThan(nfc.length);
    expect(Buffer.from(nfd, "utf8").equals(Buffer.from(nfc, "utf8"))).toBe(false);
    const stored: ExistingSend = { userMessageId: "m-9", responseId: "r-9", normalizedContent: nfc };
    expect(classifySend(stored, nfc)).toEqual({ kind: "duplicate", userMessageId: "m-9", responseId: "r-9" });
    expect(classifySend(stored, nfd)).toEqual({ kind: "conflict" });
  });
});

describe("checkActiveResponseGate (§3.4a)", () => {
  it("blocks only when a response is active", () => {
    expect(checkActiveResponseGate(true)).toBe("blocked");
    expect(checkActiveResponseGate(false)).toBe("ok");
  });
});
