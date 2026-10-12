/**
 * Send message — apps/api/src/usecases/send-message.ts. SPECS §3.1, §3.3,
 * §3.4, §3.4a, §4.4, §5.5 (FR-002, FR-006, FR-009, AC-006, AC-008, AC-009,
 * AC-019; one-active-response gate: user-directed correction 2026-09-27).
 *
 * Content is normalized and checked before any persistence (§3.1). Then one
 * UnitOfWork, no await inside, in the §5.5 order. The provider run starts only
 * after that transaction commits, and it is never awaited here.
 */
import {
  checkContent,
  deriveConversationTitle,
  messageIdSchema,
  normalizeContent,
  responseIdSchema,
  type SendMessageAccepted,
} from "@rosetta-poc/chat-shared";
import {
  ContentValidationError,
  IdempotencyKeyConflictError,
  NotFoundError,
  ResponseAlreadyActiveError,
} from "../domain/errors.js";
import { checkActiveResponseGate, classifySend } from "../domain/idempotency.js";
import type { ConversationId, ResponseId } from "../domain/types.js";
import type {
  Clock,
  ConversationRepo,
  IdGenerator,
  MessageRepo,
  ResponseRepo,
  UnitOfWork,
} from "../ports.js";
import { toWireResponse } from "./get-conversation.js";

export interface StartRunJob {
  readonly responseId: ResponseId;
  readonly conversationId: ConversationId;
  readonly normalizedContent: string;
}

/** Fire-and-forget provider run; the container owns the shutdown registry (SPECS §7.5). */
export type StartRun = (job: StartRunJob) => void;

export interface SendMessageDeps {
  readonly uow: UnitOfWork;
  readonly conversations: ConversationRepo;
  readonly messages: MessageRepo;
  readonly responses: ResponseRepo;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly startRun: StartRun;
}

export interface SendMessageInput {
  readonly conversationId: ConversationId;
  readonly clientMessageId: string;
  readonly content: string;
}

/**
 * The full, current userMessage/response pair, re-read inside the transaction.
 * MessageRepo has no findById (SPECS §5.3), so the message is found in the
 * conversation history.
 */
function loadAccepted(
  deps: SendMessageDeps,
  conversationId: ConversationId,
  userMessageId: string,
  responseId: ResponseId,
): SendMessageAccepted {
  const userMessage = deps.messages
    .listByConversation(conversationId)
    .find((message) => message.id === userMessageId);
  const record = deps.responses.findById(responseId);
  if (userMessage === undefined || record === null) {
    throw new Error("Send pair was not read back");
  }
  return { conversationId, userMessage, response: toWireResponse(deps.responses, record) };
}

/** POST /api/conversations/:conversationId/messages body — one 202 for new and duplicate (R5). */
export function sendMessage(deps: SendMessageDeps, input: SendMessageInput): SendMessageAccepted {
  const normalizedContent = normalizeContent(input.content);
  const contentCheck = checkContent(normalizedContent);
  if (contentCheck !== "ok") {
    throw new ContentValidationError(contentCheck); // AC-019, before any write
  }
  const { conversationId } = input;

  const outcome = deps.uow.run((): { accepted: SendMessageAccepted; job: StartRunJob | null } => {
    // (1)
    if (deps.conversations.findById(conversationId) === null) {
      throw new NotFoundError("conversation");
    }
    // (2) Idempotency decides first: a duplicate or conflict never reaches the gate.
    const decision = classifySend(
      deps.messages.findByIdempotencyKey(conversationId, input.clientMessageId),
      normalizedContent,
    );
    if (decision.kind === "conflict") {
      throw new IdempotencyKeyConflictError(); // AC-009, zero writes
    }
    if (decision.kind === "duplicate") {
      const responseId = responseIdSchema.parse(decision.responseId);
      return {
        accepted: loadAccepted(deps, conversationId, decision.userMessageId, responseId),
        job: null, // AC-008: no second provider run
      };
    }
    // (2b) Only a genuinely new send is gated (§3.4a).
    const active = deps.responses.findActiveByConversation(conversationId);
    if (checkActiveResponseGate(active !== null) === "blocked") {
      throw new ResponseAlreadyActiveError(); // zero writes
    }
    const now = deps.clock.now();
    // (3)
    const userMessageId = messageIdSchema.parse(deps.ids.next());
    deps.messages.insert({
      id: userMessageId,
      conversationId,
      role: "user",
      content: normalizedContent,
      clientMessageId: input.clientMessageId,
      createdAt: now,
    });
    // (4) The repository applies it only while has_user_message = 0, then sets it to 1.
    deps.conversations.setTitleIfFirstUserMessage(
      conversationId,
      deriveConversationTitle(normalizedContent),
    );
    // (5) ux_responses_one_active_per_conversation backs step 2b here.
    const responseId = responseIdSchema.parse(deps.ids.next());
    deps.responses.insert({
      id: responseId,
      conversationId,
      userMessageId,
      retryOfResponseId: null,
      createdAt: now,
      updatedAt: now,
    });
    // (6)
    deps.conversations.touch(conversationId, now);
    return {
      accepted: loadAccepted(deps, conversationId, userMessageId, responseId),
      job: { responseId, conversationId, normalizedContent },
    };
  });

  // After commit; not awaited (SPECS §5.5).
  if (outcome.job !== null) {
    deps.startRun(outcome.job);
  }
  return outcome.accepted;
}
