/**
 * Get conversation — apps/api/src/usecases/get-conversation.ts. SPECS §3.2,
 * §4.2, §4.3 (FR-002, FR-007, FR-008, AC-013, AC-016). Returns the §4.3
 * superset: all responses of the conversation plus activeResponse, so a
 * failed response's partial text and retry affordance survive a refresh.
 */
import type { GetConversationResponse, Response as WireResponse } from "@rosetta-poc/chat-shared";
import { NotFoundError } from "../domain/errors.js";
import { isActiveStatus } from "../domain/response-machine.js";
import type { ConversationId, ResponseRecord } from "../domain/types.js";
import type { ConversationRepo, MessageRepo, ResponseRepo } from "../ports.js";

export interface GetConversationDeps {
  readonly conversations: ConversationRepo;
  readonly messages: MessageRepo;
  readonly responses: ResponseRepo;
}

/** Stored record ⇒ wire Response; retriedByResponseId is derived at read time (SPECS §4.2). */
export function toWireResponse(responses: ResponseRepo, record: ResponseRecord): WireResponse {
  return {
    id: record.id,
    conversationId: record.conversationId,
    userMessageId: record.userMessageId,
    assistantMessageId: record.assistantMessageId,
    status: record.status,
    partialText: record.partialText,
    failure: record.failure,
    retryOfResponseId: record.retryOfResponseId,
    retriedByResponseId: responses.findReplacementOf(record.id),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** GET /api/conversations/:conversationId body (SPECS §4.3). */
export function getConversation(
  deps: GetConversationDeps,
  conversationId: ConversationId,
): GetConversationResponse {
  const conversation = deps.conversations.findById(conversationId);
  if (conversation === null) {
    throw new NotFoundError("conversation");
  }
  const responses = deps.responses
    .listByConversation(conversationId)
    .map((record) => toWireResponse(deps.responses, record));
  return {
    conversation,
    messages: [...deps.messages.listByConversation(conversationId)],
    responses,
    // Exactly the element of responses whose status is active, or null (R6).
    activeResponse: responses.find((response) => isActiveStatus(response.status)) ?? null,
  };
}
