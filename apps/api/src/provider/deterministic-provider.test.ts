/**
 * SPECS §3.5, §10 (FR-003, AC-003). The default provider is a pure function of
 * normalizedContent: same input ⇒ byte-identical chunks, no clock/random/env.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderChunk } from "./types.js";
import { CHUNK_TOKENS, createDeterministicProvider, deterministicChunks } from "./deterministic-provider.js";

async function collect(content: string, responseId = "r-1"): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of createDeterministicProvider().stream({ responseId, normalizedContent: content })) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deterministicChunks — worked examples (independent expected values)", () => {
  it("groups of CHUNK_TOKENS = 3, trailing space on every chunk but the last", () => {
    expect(CHUNK_TOKENS).toBe(3);
    expect(deterministicChunks("hi")).toEqual(["Mock reply: hi"]);
    expect(deterministicChunks("one")).toEqual(["Mock reply: one"]);
    expect(deterministicChunks("one two")).toEqual(["Mock reply: one ", "two"]);
    expect(deterministicChunks("one two three four")).toEqual(["Mock reply: one ", "two three four"]);
    expect(deterministicChunks("one two three four five")).toEqual(["Mock reply: one ", "two three four ", "five"]);
  });

  it("any whitespace run splits tokens; the reply joins them with single spaces", () => {
    expect(deterministicChunks("a  b\nc\t\td")).toEqual(["Mock reply: a ", "b c d"]);
  });

  it("unicode tokens pass through unchanged", () => {
    expect(deterministicChunks("héllo 😀 世界")).toEqual(["Mock reply: héllo ", "😀 世界"]);
  });
});

describe("deterministicChunks — §3.5 invariant over the §10 happy data", () => {
  const fourThousand = `${"w ".repeat(1999)}ww`;
  it("fixture: the 4000-code-point input really is 4000 code points", () => {
    expect(Array.from(fourThousand).length).toBe(4000);
  });
  it.each([
    ["single word", "hello"],
    ["multi word", "hello big wide world"],
    ["inner double spaces and a newline", "hello  big\nworld"],
    ["unicode (emoji + CJK)", "héllo 😀 世界 你好"],
    ["exactly 4000 code points", fourThousand],
  ])("%s: join === replyTokens.join(' ') and length === ceil(n/3) ≥ 1", (_label, content) => {
    const replyTokens = ["Mock", "reply:", ...content.split(/\s+/u).filter((t) => t !== "")];
    const chunks = deterministicChunks(content);
    expect(chunks.join("")).toBe(replyTokens.join(" "));
    expect(chunks.length).toBe(Math.ceil(replyTokens.length / 3));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe("provider stream", () => {
  it("yields one delta per chunk, then exactly one end", async () => {
    expect(await collect("one two three four five")).toEqual([
      { kind: "delta", text: "Mock reply: one " },
      { kind: "delta", text: "two three four " },
      { kind: "delta", text: "five" },
      { kind: "end" },
    ]);
  });

  it("AC-003: identical normalized input ⇒ byte-identical payloads, across instances and response ids", async () => {
    const content = "The quick  brown\nfox — jumps 😀 over 世界";
    const first = JSON.stringify(await collect(content, "r-a"));
    const second = JSON.stringify(await collect(content, "r-b"));
    expect(second).toBe(first);
  });

  it("different normalized input ⇒ different payloads", async () => {
    expect(JSON.stringify(await collect("alpha"))).not.toBe(JSON.stringify(await collect("beta")));
  });

  it("is pure: never reads the clock, randomness, or crypto", async () => {
    const fail = (): never => {
      throw new Error("impure call");
    };
    vi.spyOn(Date, "now").mockImplementation(fail);
    vi.spyOn(Math, "random").mockImplementation(fail);
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(fail);
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(fail);
    // "Mock reply: still " + "deterministic" + end
    await expect(collect("still deterministic")).resolves.toHaveLength(3);
  });
});
