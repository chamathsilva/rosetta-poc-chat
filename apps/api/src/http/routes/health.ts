/**
 * GET /health — apps/api/src/http/routes/health.ts. SPECS §4.3, §7.5 (FR-002,
 * FR-011). Not enveloped. 503 "unavailable" when the database check fails or
 * the process is draining.
 */
import type { HealthResponse } from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";

export interface HealthRouteDeps {
  /** SELECT 1 on the live handle (SPECS §4.3). */
  readonly checkDatabase: () => boolean;
  readonly isDraining: () => boolean;
}

function databaseOk(deps: HealthRouteDeps): boolean {
  try {
    return deps.checkDatabase();
  } catch {
    return false;
  }
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get("/health", async (_request, reply) => {
    const database = databaseOk(deps);
    const body: HealthResponse = {
      status: database && !deps.isDraining() ? "ok" : "unavailable",
      database: database ? "ok" : "error",
    };
    return reply.code(body.status === "ok" ? 200 : 503).send(body);
  });
}
