/**
 * Web configuration — apps/web/src/config/env.ts. SPECS §7.2 (FR-010,
 * AC-023). VITE_API_BASE_URL is parsed from import.meta.env at module load;
 * a failure throws before render. There is no Vite dev proxy, so the browser
 * calls the API cross-origin and CORS is genuinely exercised.
 */
import { z } from "zod";

/** Not strict: import.meta.env also carries Vite's own keys (MODE, DEV, …). */
export const webEnvSchema = z.object({
  VITE_API_BASE_URL: z.url().default("http://localhost:8787"),
});

export interface WebConfig {
  /** No trailing slash, so paths join as `${apiBaseUrl}/api/...`. */
  readonly apiBaseUrl: string;
}

/** Throws with the variable name only, never the received value. */
export function parseWebConfig(env: Readonly<Record<string, unknown>>): WebConfig {
  const result = webEnvSchema.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid web configuration: ${names}`);
  }
  return { apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/+$/u, "") };
}

export const webConfig: WebConfig = parseWebConfig(import.meta.env);
