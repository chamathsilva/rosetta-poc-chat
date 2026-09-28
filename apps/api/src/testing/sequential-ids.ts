/**
 * Sequential ids — apps/api/src/testing/sequential-ids.ts. SPECS §4.1, §10
 * (AC-003, AC-024). Injected through createContainer(config, overrides).
 *
 * Every id is a lowercase UUID v4 string, because persistence and the use
 * cases validate ids with the shared UUID schemas. The prefix fills the first
 * UUID group so ids from two generators never collide:
 * sequentialIds("a") ⇒ 0000000a-0000-4000-8000-000000000001, …0002, …
 */
import type { IdGenerator } from "../ports.js";

const PREFIX_PATTERN = /^[0-9a-f]{1,8}$/;

export function sequentialIds(prefix = "0"): IdGenerator {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError("sequentialIds prefix must be 1-8 lowercase hex digits");
  }
  const group = prefix.padStart(8, "0");
  let counter = 0;
  return {
    next() {
      counter += 1;
      return `${group}-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
    },
  };
}
