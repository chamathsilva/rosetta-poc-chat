/**
 * Boot recovery — apps/api/src/stream/recovery.ts. SPECS §5.6 (AC-014, A-002,
 * A-003). Runs once before listen, so no client can observe a stale active
 * response. Each active row is failed with PROVIDER_INTERRUPTED in its own
 * transaction:
 * - zero-event (maxSeq 0, pending): response.started@1 then response.failed@2;
 * - partial-stream (maxSeq ≥ 1, streaming): only response.failed@maxSeq+1.
 * partial_text is untouched; the response is then eligible for the standard
 * single retry unless it is itself a replacement.
 */
import { failResponse, type FailDeps } from "./runner.js";

/** Returns the number of recovered responses, for the startup log line. */
export function recoverActiveResponses(deps: FailDeps): number {
  let recovered = 0;
  for (const response of deps.responses.listActive()) {
    if (failResponse(deps, response.id, "PROVIDER_INTERRUPTED").length > 0) {
      recovered += 1;
    }
  }
  return recovered;
}
