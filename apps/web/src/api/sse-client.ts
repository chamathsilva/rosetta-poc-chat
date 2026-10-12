/**
 * SSE client — apps/web/src/api/sse-client.ts. SPECS §6.1, §6.3, §6.5
 * (FR-005, FR-007, AC-004, AC-011, AC-013). The browser's built-in SSE
 * object is deliberately never used: it cannot set Last-Event-ID on the first
 * connection, which FR-005 + FR-007 require. fetch + ReadableStream +
 * TextDecoder instead.
 *
 * Callback contract: every stream ends with exactly one final callback —
 * onClosed(reason) or onError(error) — and nothing is called after it.
 * - onClosed("terminal"): the body ended after a terminal event.
 * - onClosed("network"): fetch rejected, or the body ended/broke before a
 *   terminal event (the caller may reconnect from lastAppliedEventId, §6.5).
 * - onClosed("aborted"): close() or the caller's signal.
 * - onError: a non-2xx reply (envelope mapped per §9.2) or an invalid event
 *   payload (kind "server"); the invalid event never reaches onEvent (AC-004).
 * Reconnect policy and backoff belong to the caller (hooks/useResponseStream).
 */
import { streamEventSchema, type ResponseId, type StreamEvent } from "@rosetta-poc/chat-shared";
import type { UiError } from "../state/ui-status";
import { errorFromResponse } from "./http-client";

export interface StreamHandle {
  close(): void;
}

export interface StreamCallbacks {
  onEvent(event: StreamEvent): void;
  onError(error: UiError): void;
  onClosed(reason: "terminal" | "aborted" | "network"): void;
}

const INVALID_EVENT_ERROR: UiError = {
  kind: "server",
  code: "INVALID_EVENT",
  message: "The server sent an invalid stream event.",
  nextAction: "reload",
};

/** One frame's fields; lines starting with ":" (heartbeat comments) are ignored. */
function parseFrame(frame: string): { id: string | null; event: string | null; data: string | null } {
  let id: string | null = null;
  let event: string | null = null;
  let data: string | null = null;
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "id") {
      id = value;
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      data = value;
    }
  }
  return { id, event, data };
}

/** Validates a frame against §6.2: known type, schema-valid data, id === seq, same response. */
function toStreamEvent(frame: string, responseId: ResponseId): StreamEvent | "skip" | "invalid" {
  const { id, event, data } = parseFrame(frame);
  if (id === null && event === null && data === null) {
    return "skip"; // heartbeat or empty frame
  }
  if (event === null || data === null) {
    return "invalid";
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return "invalid";
  }
  const parsed = streamEventSchema.safeParse({ type: event, data: payload });
  if (!parsed.success || String(parsed.data.data.seq) !== id || parsed.data.data.responseId !== responseId) {
    return "invalid";
  }
  return parsed.data;
}

export function openResponseStream(
  baseUrl: string,
  responseId: ResponseId,
  lastEventId: number,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): StreamHandle {
  const controller = new AbortController();
  let finished = false;

  const finish = (end: () => void): void => {
    if (!finished) {
      finished = true;
      signal.removeEventListener("abort", abort);
      end();
    }
  };
  const abort = (): void => {
    controller.abort();
    finish(() => callbacks.onClosed("aborted"));
  };
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

  void (async () => {
    let response: globalThis.Response;
    try {
      response = await fetch(`${baseUrl}/api/responses/${encodeURIComponent(responseId)}/events`, {
        headers: { "last-event-id": String(lastEventId) },
        signal: controller.signal,
      });
    } catch {
      finish(() => callbacks.onClosed(controller.signal.aborted ? "aborted" : "network"));
      return;
    }
    if (!response.ok) {
      const error = await errorFromResponse(response);
      finish(() => callbacks.onError(error));
      return;
    }
    if (response.body === null) {
      finish(() => callbacks.onClosed("network"));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let sawTerminal = false;
    for (;;) {
      // Only the read is guarded, so a network drop is never confused with a callback bug.
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        finish(() => callbacks.onClosed(controller.signal.aborted ? "aborted" : "network"));
        return;
      }
      // At end of body, decode() with no argument flushes any buffered partial UTF-8 sequence.
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1 && !finished) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = toStreamEvent(frame, responseId);
        if (event === "invalid") {
          controller.abort();
          finish(() => callbacks.onError(INVALID_EVENT_ERROR));
          return;
        }
        if (event !== "skip") {
          sawTerminal ||= event.type === "response.completed" || event.type === "response.failed";
          try {
            callbacks.onEvent(event);
          } catch (error) {
            // A consumer bug: stop the stream silently and let the error surface to the caller.
            controller.abort();
            finish(() => {});
            throw error;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (finished) {
        return;
      }
      if (chunk.done) {
        break;
      }
    }
    finish(() => callbacks.onClosed(sawTerminal ? "terminal" : "network"));
  })();

  return { close: abort };
}
