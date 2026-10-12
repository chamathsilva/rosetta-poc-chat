/**
 * API configuration — apps/api/src/config/env.ts. SPECS §7.1 (A-007 finalized,
 * FR-006, FR-010). Parsed once at boot; a failure prints the aggregated issue
 * list and exits with code 1 before any DB or socket is opened.
 *
 * No other env var may alter behaviour: there is no provider-selection
 * variable (FR-003 "no environment-only backdoors") — provider substitution is
 * only via createContainer(config, overrides).
 */
import process from "node:process";
import { z } from "zod";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Not strict: process.env carries unrelated variables, which are stripped. */
export const envSchema = z.object({
  CHAT_DB_PATH: z.string().min(1).default("./data/chat.sqlite"), // ":memory:" allowed
  CHAT_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  CHAT_API_HOST: z.string().min(1).default("127.0.0.1"),
  CHAT_WEB_ORIGIN: z.url().default("http://localhost:5173"),
  CHAT_LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export interface AppConfig {
  readonly dbPath: string;
  readonly port: number;
  readonly host: string;
  readonly webOrigin: string; // exact CORS origin — SPECS §7.3
  readonly logLevel: LogLevel; // Fastify logger level — SPECS §7.4
}

/**
 * Fail-fast (FR-010). Issue lines carry the variable name and Zod's message
 * only, never the received value (env values are never logged — SPECS §7.4).
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    process.stderr.write(`Invalid API configuration:\n${lines.join("\n")}\n`);
    process.exit(1);
  }
  const parsed = result.data;
  return {
    dbPath: parsed.CHAT_DB_PATH,
    port: parsed.CHAT_API_PORT,
    host: parsed.CHAT_API_HOST,
    webOrigin: parsed.CHAT_WEB_ORIGIN,
    logLevel: parsed.CHAT_LOG_LEVEL,
  };
}
