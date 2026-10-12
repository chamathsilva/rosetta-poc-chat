/**
 * Event stream route — apps/api/src/http/routes/response-events.ts. SPECS
 * §4.3, §6.1, §6.3, §6.4 (FR-004, FR-005, AC-011, AC-012).
 *
 * Every rejection — non-UUID id, malformed Last-Event-ID, unknown response,
 * Last-Event-ID > maxSeq — is thrown BEFORE the reply is hijacked, so it
 * reaches the client as an ordinary JSON envelope, never after SSE headers.
 * Only the header is honoured; there is no query-parameter fallback.
 */
import {
  parseLastEventId,
  responseParamsSchema,
  type ResponseId,
} from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import {
  InvalidLastEventIdError,
  LastEventIdOutOfRangeError,
  NotFoundError,
} from "../../domain/errors.js";
import type { StreamSink } from "../../stream/subscribe.js";
import { openSseStream } from "../sse.js";

export interface ResponseEventsSource {
  exists(responseId: ResponseId): boolean;
  maxSeq(responseId: ResponseId): number;
  /** stream/subscribe.ts attachResponseStream, bound by the container. Returns detach(). */
  attach(responseId: ResponseId, lastEventId: number, sink: StreamSink): () => void;
}

export interface ResponseEventsRouteDeps {
  readonly responseEvents: ResponseEventsSource;
}

export const RESPONSE_EVENTS_ROUTE = "/api/responses/:responseId/events";

export function registerResponseEventsRoutes(
  app: FastifyInstance,
  deps: ResponseEventsRouteDeps,
): void {
  app.get(RESPONSE_EVENTS_ROUTE, (request, reply) => {
    const { responseId } = responseParamsSchema.parse(request.params);
    const header = request.headers["last-event-id"];
    const parsed = parseLastEventId(Array.isArray(header) ? header.join(",") : header);
    if (parsed.kind === "malformed") {
      throw new InvalidLastEventIdError();
    }
    if (!deps.responseEvents.exists(responseId)) {
      throw new NotFoundError("response");
    }
    if (parsed.value > deps.responseEvents.maxSeq(responseId)) {
      throw new LastEventIdOutOfRangeError();
    }
    request.log.info({ responseId, eventSeq: parsed.value }, "event stream opened");
    openSseStream(reply, (sink) => deps.responseEvents.attach(responseId, parsed.value, sink));
  });
}
