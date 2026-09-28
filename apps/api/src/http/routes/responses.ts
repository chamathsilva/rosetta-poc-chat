/**
 * Retry route — apps/api/src/http/routes/responses.ts. SPECS §4.3, §4.5
 * (FR-008, AC-017, A-003). One 202 for a new replacement and for a repeated
 * retry that returns the existing one (R5); rejections are 409.
 */
import {
  responseParamsSchema,
  type ResponseId,
  type RetryAccepted,
} from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";

export interface ResponseRouteDeps {
  readonly retryResponse: (responseId: ResponseId) => RetryAccepted;
}

export function registerResponseRoutes(app: FastifyInstance, deps: ResponseRouteDeps): void {
  app.post("/api/responses/:responseId/retry", async (request, reply) => {
    const { responseId } = responseParamsSchema.parse(request.params);
    const body = deps.retryResponse(responseId);
    request.log.info(
      { conversationId: body.conversationId, responseId: body.responseId },
      "retry accepted",
    );
    return reply.code(202).send(body);
  });
}
