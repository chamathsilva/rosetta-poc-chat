/**
 * Provider test doubles — apps/api/src/testing/provider-doubles.ts. SPECS §3.5
 * (FR-003, FR-008, AC-008, AC-016). Injected only through
 * createContainer(config, overrides) — no env var selects them. Imports no
 * test framework, so it stays inside the build project (SPECS §8.2).
 */
import { deterministicChunks } from "../provider/deterministic-provider.js";
import type {
  Provider,
  ProviderChunk,
  ProviderFailureCode,
  ProviderInput,
} from "../provider/types.js";

const DOUBLE_ERROR_MESSAGE = "provider double failure";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Deterministic chunks, each preceded by a wait of msPerChunk (slow-but-not-hung runs). */
export function delayedProvider(msPerChunk: number): Provider {
  return {
    async *stream(input: ProviderInput): AsyncGenerator<ProviderChunk> {
      for (const text of deterministicChunks(input.normalizedContent)) {
        await delay(msPerChunk);
        yield { kind: "delta", text };
      }
      await delay(msPerChunk);
      yield { kind: "end" };
    },
  };
}

/** Up to afterChunks deterministic deltas, then error PROVIDER_DISCONNECTED. */
export function disconnectingProvider(afterChunks: number): Provider {
  return {
    async *stream(input: ProviderInput): AsyncGenerator<ProviderChunk> {
      for (const text of deterministicChunks(input.normalizedContent).slice(0, afterChunks)) {
        yield { kind: "delta", text };
      }
      yield { kind: "error", code: "PROVIDER_DISCONNECTED", message: DOUBLE_ERROR_MESSAGE };
    },
  };
}

/** Immediately yields an error chunk with the given code. */
export function failingProvider(code: ProviderFailureCode): Provider {
  return {
    async *stream(): AsyncGenerator<ProviderChunk> {
      yield { kind: "error", code, message: DOUBLE_ERROR_MESSAGE };
    },
  };
}

/** Throws a native Error; the runner maps any thrown value to PROVIDER_ERROR. */
export function throwingProvider(): Provider {
  return {
    // Throws before its first yield, on the runner's first next() call.
    async *stream(): AsyncGenerator<ProviderChunk> {
      throw new Error("provider double threw");
    },
  };
}

export interface CountingProvider extends Provider {
  readonly runCount: number;
}

/** Counts stream() calls on the wrapped provider (AC-008: a duplicate send starts no run). */
export function countingProvider(inner: Provider): CountingProvider {
  let runCount = 0;
  return {
    get runCount() {
      return runCount;
    },
    stream(input: ProviderInput): AsyncIterable<ProviderChunk> {
      runCount += 1;
      return inner.stream(input);
    },
  };
}
