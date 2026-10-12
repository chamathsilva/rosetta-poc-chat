/**
 * Health-check response contract — packages/shared/src/contracts/health.ts.
 * SPECS §4.3 (GET /health). Not enveloped like error responses.
 *
 * Added as its own module by orchestrator-approved execution-discovered
 * specification correction (2026-09-27): the original §2.1 layout named six
 * contracts files (conversation/message/response/events/errors/params), none
 * of which a healthResponseSchema fits without stretching its stated scope.
 */
import { z } from "zod";

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    database: z.enum(["ok", "error"]),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;
