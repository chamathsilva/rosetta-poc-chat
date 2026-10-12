/**
 * SPECS §2.2, §6.4, §7.5 (FR-004, FR-005, FR-011). The in-process hub routes a
 * committed event only to subscribers of that event's response, isolates a
 * failing subscriber, and ends every subscriber on closeAll without an event.
 */
import { responseIdSchema, type ResponseId } from "@rosetta-poc/chat-shared";
import { describe, expect, it, vi } from "vitest";
import type { PersistedEvent } from "../domain/types.js";
import { createStreamHub, type HubSubscriber } from "./hub.js";

const A = responseIdSchema.parse("33333333-3333-4333-8333-00000000000a");
const B = responseIdSchema.parse("33333333-3333-4333-8333-00000000000b");
const T = "2026-09-28T10:00:00.000Z";

const delta = (responseId: ResponseId, seq: number, text = "x"): PersistedEvent => ({
  type: "response.delta",
  data: { responseId, seq, text },
  responseId,
  seq,
  createdAt: T,
});

function recorder(): HubSubscriber & { events: PersistedEvent[]; closes: number } {
  const events: PersistedEvent[] = [];
  const self = {
    events,
    closes: 0,
    onEvent: (event: PersistedEvent) => {
      events.push(event);
    },
    onClose: () => {
      self.closes += 1;
    },
  };
  return self;
}

describe("createStreamHub", () => {
  it("delivers an event only to subscribers of its response (FR-005)", () => {
    const hub = createStreamHub();
    const a1 = recorder();
    const a2 = recorder();
    const b = recorder();
    hub.subscribe(A, a1);
    hub.subscribe(A, a2);
    hub.subscribe(B, b);
    hub.publish(delta(A, 2));
    hub.publish(delta(B, 2));
    expect(a1.events.map((e) => e.responseId)).toEqual([A]);
    expect(a2.events.map((e) => e.responseId)).toEqual([A]);
    expect(b.events.map((e) => e.responseId)).toEqual([B]);
  });

  it("publishing with no subscribers is a no-op", () => {
    expect(() => createStreamHub().publish(delta(A, 1))).not.toThrow();
  });

  it("unsubscribe stops delivery, is idempotent, and leaves other subscribers attached", () => {
    const hub = createStreamHub();
    const gone = recorder();
    const stays = recorder();
    const unsubscribe = hub.subscribe(A, gone);
    hub.subscribe(A, stays);
    unsubscribe();
    unsubscribe();
    hub.publish(delta(A, 2));
    expect(gone.events).toEqual([]);
    expect(stays.events).toHaveLength(1);
  });

  it("a subscriber may unsubscribe while handling an event without disturbing the others", () => {
    const hub = createStreamHub();
    const later = recorder();
    let unsubscribeSelf = (): void => {};
    const selfRemoving: HubSubscriber = {
      onEvent: () => {
        unsubscribeSelf();
      },
      onClose: () => {},
    };
    unsubscribeSelf = hub.subscribe(A, selfRemoving);
    hub.subscribe(A, later);
    hub.publish(delta(A, 2));
    hub.publish(delta(A, 3));
    expect(later.events.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("a throwing subscriber is dropped; the publisher and the other subscribers are unaffected", () => {
    const hub = createStreamHub();
    const onEvent = vi.fn(() => {
      throw new Error("dead socket");
    });
    const healthy = recorder();
    hub.subscribe(A, { onEvent, onClose: () => {} });
    hub.subscribe(A, healthy);
    expect(() => hub.publish(delta(A, 2))).not.toThrow();
    hub.publish(delta(A, 3));
    expect(onEvent).toHaveBeenCalledTimes(1); // dropped after its first failure
    expect(healthy.events.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("closeAll ends every subscriber exactly once without an event, then holds no subscribers", () => {
    const hub = createStreamHub();
    const a = recorder();
    const b = recorder();
    hub.subscribe(A, a);
    hub.subscribe(B, b);
    hub.closeAll();
    hub.publish(delta(A, 2));
    hub.closeAll();
    expect([a.closes, b.closes]).toEqual([1, 1]);
    expect([a.events, b.events]).toEqual([[], []]);
  });

  it("closeAll continues past a subscriber whose onClose throws", () => {
    const hub = createStreamHub();
    const after = recorder();
    hub.subscribe(A, { onEvent: () => {}, onClose: () => { throw new Error("x"); } });
    hub.subscribe(B, after);
    expect(() => hub.closeAll()).not.toThrow();
    expect(after.closes).toBe(1);
  });
});
