/**
 * Stream hub — apps/api/src/stream/hub.ts. SPECS §2.2, §6.4, §7.5 (FR-004,
 * FR-005, FR-011). In-process fan-out of committed events to live
 * subscribers, keyed by responseId (R7: one process, no cross-process
 * sharing). The hub only delivers; persistence happens before publish
 * (persist-then-emit, runner.ts).
 */
import type { PersistedEvent, ResponseId } from "../domain/types.js";

export interface HubSubscriber {
  onEvent(event: PersistedEvent): void;
  /** Called by closeAll (shutdown); the subscriber ends without writing a frame. */
  onClose(): void;
}

export interface StreamHub {
  /** Returns the unsubscribe function. */
  subscribe(responseId: ResponseId, subscriber: HubSubscriber): () => void;
  publish(event: PersistedEvent): void;
  closeAll(): void;
}

export function createStreamHub(): StreamHub {
  const subscribers = new Map<ResponseId, Set<HubSubscriber>>();

  function unsubscribe(responseId: ResponseId, subscriber: HubSubscriber): void {
    const set = subscribers.get(responseId);
    if (set === undefined) {
      return;
    }
    set.delete(subscriber);
    if (set.size === 0) {
      subscribers.delete(responseId);
    }
  }

  return {
    subscribe(responseId, subscriber) {
      const set = subscribers.get(responseId) ?? new Set<HubSubscriber>();
      set.add(subscriber);
      subscribers.set(responseId, set);
      return () => {
        unsubscribe(responseId, subscriber);
      };
    },
    publish(event) {
      // Copy: a subscriber may unsubscribe while it handles a terminal event.
      for (const subscriber of [...(subscribers.get(event.responseId) ?? [])]) {
        try {
          subscriber.onEvent(event);
        } catch {
          // A failing subscriber (e.g. a dead socket) must not affect the runner or
          // other subscribers; it is dropped. The event is already committed.
          unsubscribe(event.responseId, subscriber);
        }
      }
    },
    closeAll() {
      const all = [...subscribers.values()].flatMap((set) => [...set]);
      subscribers.clear();
      for (const subscriber of all) {
        try {
          subscriber.onClose();
        } catch {
          // Shutdown continues regardless of one subscriber.
        }
      }
    },
  };
}
