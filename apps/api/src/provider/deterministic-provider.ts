/**
 * Deterministic default provider — apps/api/src/provider/deterministic-provider.ts.
 * SPECS §3.5 (FR-003, AC-003). A pure function of normalizedContent only: no
 * clock, no Math.random, no crypto, no network, no env read.
 */
import type { Provider, ProviderChunk, ProviderInput } from "./types.js";

export const CHUNK_TOKENS = 3;

/**
 * Invariant: chunks.join("") === replyTokens.join(" ") and
 * chunks.length === Math.ceil(replyTokens.length / CHUNK_TOKENS) ≥ 1.
 */
export function deterministicChunks(normalizedContent: string): readonly string[] {
  const tokens = normalizedContent.split(/\s+/u).filter((t) => t !== "");
  const replyTokens = ["Mock", "reply:", ...tokens];
  const chunks: string[] = [];
  for (let start = 0; start < replyTokens.length; start += CHUNK_TOKENS) {
    const group = replyTokens.slice(start, start + CHUNK_TOKENS).join(" ");
    const isLast = start + CHUNK_TOKENS >= replyTokens.length;
    chunks.push(isLast ? group : `${group} `);
  }
  return chunks;
}

export function createDeterministicProvider(): Provider {
  return {
    async *stream(input: ProviderInput): AsyncGenerator<ProviderChunk> {
      for (const text of deterministicChunks(input.normalizedContent)) {
        yield { kind: "delta", text };
      }
      yield { kind: "end" };
    },
  };
}
