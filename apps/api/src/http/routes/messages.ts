/**
 * Send route — apps/api/src/http/routes/messages.ts. SPECS §4.3, §4.4, §5.5
 * (FR-002, FR-009, AC-008, AC-009, AC-019). One 202 for a new send and an
 * idempotent replay (R5). The use case starts the provider run after commit;
 * this handler never awaits it.
 */
import {
  codePointLength,
  conversationParamsSchema,
  sendMessageRequestSchema,
  type SendMessageAccepted,
} from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import type { SendMessageInput } from "../../usecases/send-message.js";

export interface MessageRouteDeps {
  readonly sendMessage: (input: SendMessageInput) => SendMessageAccepted;
}

export function registerMessageRoutes(app: FastifyInstance, deps: MessageRouteDeps): void {
  app.post("/api/conversations/:conversationId/messages", async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    const { clientMessageId, content } = sendMessageRequestSchema.parse(request.body);
    const body = deps.sendMessage({ conversationId, clientMessageId, content });
    // Ids and a length only — never the content itself (SPECS §7.4).
    request.log.info(
      {
        conversationId,
        messageId: body.userMessage.id,
        responseId: body.response.id,
        contentLength: codePointLength(body.userMessage.content),
      },
      "message accepted",
    );
    return reply.code(202).send(body);
  });
}
