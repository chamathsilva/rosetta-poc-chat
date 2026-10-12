/**
 * SSE framing — apps/api/src/http/sse.ts. SPECS §6.1, §6.4 (FR-004, FR-005,
 * AC-003, AC-010). The handler hijacks the reply, so no body serializer
 * touches a frame. Each event is exactly `id:`, `event:`, one compact `data:`
 * line, blank line. The heartbeat is a comment frame with no `id:` and no
 * `event:`, so it cannot perturb the id sequence.
 */
import type { FastifyReply } from "fastify";
import type { PersistedEvent } from "../domain/types.js";
import type { StreamSink } from "../stream/subscribe.js";

export const SSE_HEARTBEAT_MS = 15000;
export const SSE_HEARTBEAT_FRAME = ": ping\n\n";

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

/** data is JSON.stringify output: no spaces, and text is JSON-escaped, so never a raw newline. */
export function formatSseEvent(event: PersistedEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Takes over the raw response and hands attach() a sink. Headers already set
 * on the reply (the CORS headers from @fastify/cors) are carried over, because
 * a hijacked reply does not write them. Client disconnect clears the
 * heartbeat and detaches; it never touches response state (SPECS §6.4).
 */
export function openSseStream(
  reply: FastifyReply,
  attach: (sink: StreamSink) => () => void,
): void {
  reply.hijack();
  const raw = reply.raw;
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) {
      headers[name] = typeof value === "number" ? String(value) : value;
    }
  }
  raw.writeHead(200, { ...headers, ...SSE_HEADERS });

  let closed = false;
  let detach = (): void => {};
  const heartbeat = setInterval(() => {
    write(SSE_HEARTBEAT_FRAME);
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  function write(frame: string): void {
    if (!closed && !raw.writableEnded && !raw.destroyed) {
      raw.write(frame);
    }
  }
  function stop(): void {
    if (!closed) {
      closed = true;
      clearInterval(heartbeat);
    }
  }
  function onDisconnect(): void {
    stop();
    detach();
  }
  reply.request.raw.on("close", onDisconnect); // client abort (SPECS §6.4)
  raw.on("error", onDisconnect); // a failed socket write must not crash the process

  try {
    detach = attach({
      write(event) {
        write(formatSseEvent(event));
      },
      end() {
        stop();
        if (!raw.writableEnded) {
          raw.end();
        }
      },
    });
  } catch {
    // Headers are already sent, so no envelope is possible: drop the connection.
    stop();
    raw.destroy();
  }
}
