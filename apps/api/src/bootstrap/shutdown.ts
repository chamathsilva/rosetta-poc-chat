/**
 * Shutdown — apps/api/src/bootstrap/shutdown.ts. SPECS §7.5 (FR-011).
 *
 * Bounded drain: aborted runners get up to SHUTDOWN_TIMEOUT_MS to finish or
 * roll back their in-flight write before the database handle closes. Awaiting
 * only abort(), without each runner's settle promise, is the bug step 4
 * exists to prevent. A runner that exceeds the timeout does not block
 * shutdown.
 */
import process from "node:process";
import type { FastifyInstance } from "fastify";
import { closeDatabase } from "../persistence/db.js";
import type { Container } from "./container.js";

export const SHUTDOWN_TIMEOUT_MS = 5000;

/** Steps 1–6 of SPECS §7.5. Does not exit the process (step 7 belongs to the signal handler). */
export async function shutdown(
  container: Container,
  app: FastifyInstance,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  // (1) /health 503; POST routes and new event streams 503.
  container.startDraining();
  // (2) Abort every in-flight run.
  const inFlight = [...container.registry];
  for (const entry of inFlight) {
    entry.controller.abort();
  }
  // (3) End every open SSE response without writing a frame.
  container.hub.closeAll();
  // (4) Bounded drain.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.allSettled(inFlight.map((entry) => entry.promise)), timeout]);
  clearTimeout(timer);
  // (5)
  await app.close();
  // (6)
  closeDatabase(container.db);
}

/**
 * SIGINT/SIGTERM run `stop` once, then exit 0 (or 1 if it failed). A second
 * signal exits 1 immediately (SPECS §7.5 step 7).
 */
export function installShutdownSignals(
  stop: () => Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let stopping = false;
  const onSignal = (): void => {
    if (stopping) {
      exit(1);
      return;
    }
    stopping = true;
    stop().then(
      () => exit(0),
      () => exit(1),
    );
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
