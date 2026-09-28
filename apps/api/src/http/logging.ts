/**
 * Structured logging — apps/api/src/http/logging.ts. SPECS §7.4 (FR-011,
 * AC-021, A-006). Fastify logger at config.logLevel; only allowlisted fields
 * ever reach a log line. Message content, provider text, SQL, stack traces,
 * headers and env values are never logged, not even truncated.
 *
 * Fastify's automatic request logs (which carry req/res objects, url and
 * responseTime) are disabled; server.ts logs one allowlisted line per response
 * instead. The pino `log` and `bindings` formatters drop every non-allowlisted
 * key, so a stray field (for example an `err` object) can never be written.
 */
import { LogController, type FastifyServerOptions } from "fastify";
import type { LogLevel } from "../config/env.js";

/** Exhaustive field allowlist (SPECS §7.4). */
export const LOG_FIELD_ALLOWLIST = [
  "requestId",
  "method",
  "routePath",
  "statusCode",
  "durationMs",
  "conversationId",
  "responseId",
  "messageId",
  "contentLength",
  "eventSeq",
  "eventType",
  "errorCode",
  "recoveredResponses",
] as const;

export type LogFields = Partial<Record<(typeof LOG_FIELD_ALLOWLIST)[number], string | number>>;

const ALLOWED = new Set<string>(LOG_FIELD_ALLOWLIST);

/** Keeps only allowlisted keys with scalar values. */
export function pickLogFields(object: Record<string, unknown>): LogFields {
  const picked: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(object)) {
    if (ALLOWED.has(key) && (typeof value === "string" || typeof value === "number")) {
      picked[key] = value;
    }
  }
  return picked;
}

export function loggerOptions(
  level: LogLevel,
): Pick<FastifyServerOptions, "logger" | "logController"> {
  return {
    logger: {
      level,
      base: null, // no pid / hostname
      formatters: {
        bindings: (bindings) => pickLogFields(bindings),
        log: (object) => pickLogFields(object),
      },
    },
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "requestId",
    }),
  };
}
