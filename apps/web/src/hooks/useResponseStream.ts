/**
 * Response streams — apps/web/src/hooks/useResponseStream.ts. SPECS §6.5,
 * §9.4 rules 6–7 (FR-005, FR-007, AC-011, AC-013).
 *
 * Keeps exactly one open stream per streamable response: `streamClosed ===
 * false` and an active status. Opening and reconnecting are gated by those two
 * facts, never by a numeric sentinel (rule 6). Each (re)connect reads
 * `lastAppliedEventId` at the moment it opens, so a replay starts where the
 * reducer's monotone guard already is.
 *
 * Reconnect policy: a `network` close while the response is still streamable
 * reconnects after [250, 500, 1000, 2000, 4000] ms (capped at 4000), at most 6
 * attempts, then surfaces a `network` error with action `reload`. The attempt
 * counter is the reducer's `reconnectAttempt`, which a successful event resets.
 */
import type { ResponseId } from "@rosetta-poc/chat-shared";
import { useEffect, useRef, type Dispatch } from "react";
import { networkError } from "../api/http-client";
import { openResponseStream, type StreamHandle } from "../api/sse-client";
import type { ChatAction, ChatState, UiResponse } from "../state/chat-reducer";

export const RECONNECT_BACKOFF_MS: readonly number[] = [250, 500, 1000, 2000, 4000];
export const MAX_RECONNECT_ATTEMPTS = 6;

interface StreamEntry {
  controller: AbortController;
  handle: StreamHandle | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function isStreamable(response: UiResponse | undefined): boolean {
  return (
    response !== undefined &&
    !response.streamClosed &&
    response.status !== "completed" &&
    response.status !== "failed"
  );
}

export function useResponseStream(
  baseUrl: string,
  state: ChatState,
  dispatch: Dispatch<ChatAction>,
): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const streamsRef = useRef(new Map<ResponseId, StreamEntry>());

  const wanted = Object.values(state.responses)
    .filter(isStreamable)
    .map((response) => response.id)
    .sort();
  const wantedKey = wanted.join(",");

  useEffect(() => {
    const streams = streamsRef.current;

    const stop = (responseId: ResponseId): void => {
      const entry = streams.get(responseId);
      if (entry === undefined) {
        return;
      }
      streams.delete(responseId);
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
      }
      entry.controller.abort();
    };

    const open = (responseId: ResponseId, entry: StreamEntry): void => {
      entry.timer = null;
      dispatch({ type: "stream/opening", responseId });
      const lastEventId = stateRef.current.responses[responseId]?.lastAppliedEventId ?? 0;
      // Callbacks from a stream that was stopped or replaced are ignored.
      const current = (): boolean => streams.get(responseId) === entry && !entry.controller.signal.aborted;
      entry.handle = openResponseStream(
        baseUrl,
        responseId,
        lastEventId,
        {
          onEvent(event) {
            if (current()) {
              dispatch({ type: "stream/event", event });
            }
          },
          onError(error) {
            if (current()) {
              streams.delete(responseId);
              dispatch({ type: "stream/error", responseId, error });
            }
          },
          onClosed(reason) {
            if (!current()) {
              return;
            }
            if (reason === "terminal") {
              streams.delete(responseId);
              dispatch({ type: "stream/closed", responseId, reason });
              return;
            }
            const response = stateRef.current.responses[responseId];
            if (reason === "aborted" || !isStreamable(response) || response === undefined) {
              streams.delete(responseId);
              dispatch({ type: "stream/closed", responseId, reason });
              return;
            }
            // reason === "network" while still streamable (§6.5).
            if (response.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
              streams.delete(responseId);
              dispatch({ type: "stream/error", responseId, error: networkError("other") });
              return;
            }
            const delay =
              RECONNECT_BACKOFF_MS[Math.min(response.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 4000;
            dispatch({ type: "stream/reconnecting", responseId });
            entry.handle = null;
            entry.timer = setTimeout(() => {
              if (streams.get(responseId) === entry && isStreamable(stateRef.current.responses[responseId])) {
                open(responseId, entry);
              }
            }, delay);
          },
        },
        entry.controller.signal,
      );
    };

    const wantedIds = new Set(wantedKey === "" ? [] : wantedKey.split(","));
    for (const responseId of [...streams.keys()]) {
      if (!wantedIds.has(responseId)) {
        stop(responseId);
      }
    }
    for (const response of Object.values(stateRef.current.responses)) {
      if (wantedIds.has(response.id) && !streams.has(response.id)) {
        const entry: StreamEntry = { controller: new AbortController(), handle: null, timer: null };
        streams.set(response.id, entry);
        open(response.id, entry);
      }
    }
  }, [baseUrl, dispatch, wantedKey]);

  // Unmount (and React StrictMode's simulated unmount): close everything.
  useEffect(() => {
    const streams = streamsRef.current;
    return () => {
      for (const entry of streams.values()) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer);
        }
        entry.controller.abort();
      }
      streams.clear();
    };
  }, []);
}
