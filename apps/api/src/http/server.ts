/**
 * HTTP server — apps/api/src/http/server.ts. SPECS §4.3, §4.6, §7.3, §7.4,
 * §7.5 (FR-002, FR-010, FR-011, AC-004, AC-021, AC-023). buildServer(deps)
 * wires CORS, request ids, the JSON body parser, the draining gate, the
 * error envelope and the routes. It does not listen; the entrypoint does.
 *
 * http/* depends on use-case functions and shared contracts only: every
 * capability arrives through deps, bound by bootstrap/container.ts.
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { LogLevel } from "../config/env.js";
import { ServiceUnavailableError } from "../domain/errors.js";
import {
  HTTP_STATUS_BY_CODE,
  RequestBodyError,
  routeNotFoundEnvelope,
  toErrorEnvelope,
} from "./error-envelope.js";
import { loggerOptions } from "./logging.js";
import { registerConversationRoutes, type ConversationRouteDeps } from "./routes/conversations.js";
import { registerHealthRoutes, type HealthRouteDeps } from "./routes/health.js";
import { registerMessageRoutes, type MessageRouteDeps } from "./routes/messages.js";
import {
  RESPONSE_EVENTS_ROUTE,
  registerResponseEventsRoutes,
  type ResponseEventsRouteDeps,
} from "./routes/response-events.js";
import { registerResponseRoutes, type ResponseRouteDeps } from "./routes/responses.js";

export interface ServerDeps
  extends HealthRouteDeps,
    ConversationRouteDeps,
    MessageRouteDeps,
    ResponseRouteDeps,
    ResponseEventsRouteDeps {
  readonly webOrigin: string;
  readonly logLevel: LogLevel;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ ...loggerOptions(deps.logLevel) });

  // AC-023: exact single origin — no wildcard, no regex, no reflection. last-event-id must be
  // allowed or the cross-origin SSE request of §6.5 fails preflight.
  app.register(cors, {
    origin: [deps.webOrigin],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "last-event-id"],
    credentials: false,
    maxAge: 600,
  });

  // An empty JSON body is an absent body (POST /api/conversations: absent ≡ {}); invalid JSON
  // becomes VALIDATION_FAILED without echoing the body.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new RequestBodyError(), undefined);
    }
  });

  // Draining (§7.5 step 1): POST routes and new event streams get 503. /health reports it itself.
  // preHandler runs after the CORS onRequest hook, so the 503 still carries CORS headers.
  app.addHook("preHandler", async (request) => {
    if (
      deps.isDraining() &&
      (request.method === "POST" || request.routeOptions.url === RESPONSE_EVENTS_ROUTE)
    ) {
      throw new ServiceUnavailableError();
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        routePath: request.routeOptions.url ?? "",
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });

  app.setErrorHandler(async (error, request, reply) => {
    const envelope = toErrorEnvelope(error, request.id);
    const statusCode = HTTP_STATUS_BY_CODE[envelope.error.code];
    const fields = { errorCode: envelope.error.code, statusCode };
    if (statusCode >= 500) {
      request.log.error(fields, "request failed");
    } else {
      request.log.warn(fields, "request rejected");
    }
    return reply.code(statusCode).send(envelope);
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send(routeNotFoundEnvelope(request.id));
  });

  registerHealthRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerResponseRoutes(app, deps);
  registerResponseEventsRoutes(app, deps);
  return app;
}
