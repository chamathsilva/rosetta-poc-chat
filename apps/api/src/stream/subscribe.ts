/**
 * Replay/live handoff — apps/api/src/stream/subscribe.ts. SPECS §2.2
 * STREAM-INV-1, §6.4 (FR-005, AC-011).
 *
 * Steps 1–5 run in ONE synchronous block: no await, no queueMicrotask, no
 * Promise.then between them. Synchronous node:sqlite plus the single-threaded
 * loop makes the handoff atomic; the seq ≤ maxSent filter keeps it correct
 * even if that is ever violated. Validation of lastEventId against maxSeq
 * (400s) and SSE framing belong to the HTTP layer.
 */
import { isTerminalEventType } from "../domain/response-machine.js";
import type { PersistedEvent, ResponseId } from "../domain/types.js";
import type { EventRepo } from "../ports.js";
import type { StreamHub } from "./hub.js";

export interface StreamSink {
  write(event: PersistedEvent): void;
  end(): void;
}

export interface SubscribeDeps {
  readonly hub: StreamHub;
  readonly events: EventRepo;
}

/**
 * Frames arrive in strictly increasing seq, never twice, and the sink ends
 * after the terminal frame. Returns detach(), for client abort: it
 * unsubscribes without ending the sink and never touches response state.
 */
export function attachResponseStream(
  deps: SubscribeDeps,
  responseId: ResponseId,
  lastEventId: number,
  sink: StreamSink,
): () => void {
  const buffer: PersistedEvent[] = [];
  let live = false;
  let ended = false;
  let maxSent = lastEventId;

  function finish(): void {
    if (ended) {
      return;
    }
    ended = true;
    unsubscribe();
    sink.end();
  }

  function deliver(event: PersistedEvent): void {
    if (ended || event.seq <= maxSent) {
      return;
    }
    sink.write(event);
    maxSent = event.seq;
    if (isTerminalEventType(event.type)) {
      finish();
    }
  }

  // (1) Subscribe with a buffering sink.
  const unsubscribe = deps.hub.subscribe(responseId, {
    onEvent(event) {
      if (live) {
        deliver(event);
      } else {
        buffer.push(event);
      }
    },
    onClose: finish,
  });
  try {
    // (2) Synchronous backfill, keyed by response_id (FR-005).
    const backlog = deps.events.listAfter(responseId, lastEventId);
    // (3) Write the backlog, tracking maxSent.
    for (const event of backlog) {
      deliver(event);
    }
    // (4) Flush the buffer, dropping seq ≤ maxSent, then go live.
    live = true;
    for (const event of buffer.splice(0)) {
      deliver(event);
    }
    // (5) Terminal and drained ⇒ end (covers lastEventId === maxSeq: zero frames).
    if (!ended && deps.events.hasTerminal(responseId)) {
      finish();
    }
  } catch (error) {
    // A synchronous DB/read or socket/write failure must not leave the
    // buffering subscriber attached after this function exits by throwing.
    ended = true;
    unsubscribe();
    throw error;
  }

  return () => {
    if (!ended) {
      ended = true;
      unsubscribe();
    }
  };
}
