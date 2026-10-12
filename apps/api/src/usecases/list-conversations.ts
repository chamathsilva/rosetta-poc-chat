/**
 * List conversations — apps/api/src/usecases/list-conversations.ts. SPECS
 * §4.3, §5.2 ordering contract (FR-001, FR-002, AC-007). Order is the
 * repository's `updated_seq DESC, id ASC`, independent of Clock.
 */
import type { ListConversationsResponse } from "@rosetta-poc/chat-shared";
import type { ConversationRepo } from "../ports.js";

export interface ListConversationsDeps {
  readonly conversations: ConversationRepo;
}

/** GET /api/conversations body — `{ conversations }` (SPECS §4.3). */
export function listConversations(deps: ListConversationsDeps): ListConversationsResponse {
  return { conversations: [...deps.conversations.listSummaries()] };
}
