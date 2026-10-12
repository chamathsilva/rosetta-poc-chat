/**
 * Create conversation — apps/api/src/usecases/create-conversation.ts. SPECS
 * §3.3, §4.3 (FR-001, FR-002, A-010). The title starts as the placeholder and
 * is written once, with the first user message (send-message.ts).
 */
import {
  conversationIdSchema,
  deriveConversationTitle,
  type CreateConversationResponse,
} from "@rosetta-poc/chat-shared";
import type { Clock, ConversationRepo, IdGenerator, UnitOfWork } from "../ports.js";

export interface CreateConversationDeps {
  readonly uow: UnitOfWork;
  readonly conversations: ConversationRepo;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** POST /api/conversations body — `{ conversation }` (SPECS §4.3). */
export function createConversation(deps: CreateConversationDeps): CreateConversationResponse {
  return deps.uow.run(() => {
    const now = deps.clock.now();
    const id = conversationIdSchema.parse(deps.ids.next());
    deps.conversations.insert({
      id,
      title: deriveConversationTitle(null), // placeholder (R8)
      createdAt: now,
      updatedAt: now,
    });
    const conversation = deps.conversations.findById(id);
    if (conversation === null) {
      throw new Error("Inserted conversation was not read back");
    }
    return { conversation };
  });
}
