/**
 * Fake clock — apps/api/src/testing/fake-clock.ts. SPECS §10 (AC-003,
 * AC-007, AC-024). Injected through createContainer(config, overrides).
 * Time stands still until advanced, so identical-timestamp cases (AC-007)
 * need no extra setup. Imports no test framework (SPECS §8.2).
 */
import type { Clock } from "../ports.js";

export interface FakeClock extends Clock {
  advance(ms: number): void;
}

/** startIso must be an ISO-8601 UTC timestamp, e.g. "2026-09-28T10:00:00.000Z". */
export function fakeClock(startIso: string): FakeClock {
  let current = Date.parse(startIso);
  if (Number.isNaN(current)) {
    throw new RangeError("fakeClock needs an ISO-8601 start timestamp");
  }
  return {
    now() {
      return new Date(current).toISOString();
    },
    advance(ms) {
      current += ms;
    },
  };
}
