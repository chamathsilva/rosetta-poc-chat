/**
 * Conversation routes — apps/api/src/http/routes/conversations.ts. SPECS
 * §4.1, §4.3 (FR-002, FR-010, AC-004, AC-019). Request bodies and path
 * params are parsed with the shared schemas; a failure is a ZodError, which
 * the error handler maps to 400 VALIDATION_FAILED.
 */
import {
  conversationParamsSchema,
  createConversationRequestSchema,
  type ConversationId,
  type CreateConversationResponse,
  type GetConversationResponse,
  type ListConversationsResponse,
} from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";

export interface ConversationRouteDeps {
  readonly createConversation: () => CreateConversationResponse;
  readonly listConversations: () => ListConversationsResponse;
  readonly getConversation: (conversationId: ConversationId) => GetConversationResponse;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  deps: ConversationRouteDeps,
): void {
  app.post("/api/conversations", async (request, reply) => {
    createConversationRequestSchema.parse(request.body ?? {}); // absent body ≡ {}
    const body = deps.createConversation();
    request.log.info({ conversationId: body.conversation.id }, "conversation created");
    return reply.code(201).send(body);
  });

  app.get("/api/conversations", async (_request, reply) => {
    return reply.code(200).send(deps.listConversations());
  });

  app.get("/api/conversations/:conversationId", async (request, reply) => {
    const { conversationId } = conversationParamsSchema.parse(request.params);
    return reply.code(200).send(deps.getConversation(conversationId));
  });
}
