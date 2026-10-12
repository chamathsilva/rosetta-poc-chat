/**
 * Retry response — apps/api/src/usecases/retry-response.ts. SPECS §3.4, §4.5
 * (FR-008, AC-017, A-003). One 202 for a new replacement and for a repeated
 * retry that returns the existing one (R5); rejections are 409. A retry adds
 * a new response for the same userMessageId and never a new message.
 *
 * classifyRetry's check order is fixed. The replacement run starts only after
 * the transaction commits, and it is never awaited here.
 */
import { responseIdSchema, type RetryAccepted } from "@rosetta-poc/chat-shared";
import {
  NotFoundError,
  ResponseAlreadyActiveError,
  ResponseNotFailedError,
  RetryNotAllowedError,
} from "../domain/errors.js";
import { checkActiveResponseGate } from "../domain/idempotency.js";
import { classifyRetry } from "../domain/retry.js";
import type { ResponseId } from "../domain/types.js";
import type { Clock, IdGenerator, MessageRepo, ResponseRepo, UnitOfWork } from "../ports.js";
import type { StartRun, StartRunJob } from "./send-message.js";

export interface RetryResponseDeps {
  readonly uow: UnitOfWork;
  readonly messages: MessageRepo;
  readonly responses: ResponseRepo;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly startRun: StartRun;
}

/** POST /api/responses/:responseId/retry body (SPECS §4.3). */
export function retryResponse(deps: RetryResponseDeps, responseId: ResponseId): RetryAccepted {
  const outcome = deps.uow.run((): { accepted: RetryAccepted; job: StartRunJob | null } => {
    const target = deps.responses.findById(responseId);
    if (target === null) {
      throw new NotFoundError("response");
    }
    const decision = classifyRetry(
      { status: target.status, retryOfResponseId: target.retryOfResponseId },
      deps.responses.findReplacementOf(target.id),
    );
    if (decision.kind === "rejected") {
      throw decision.code === "RETRY_NOT_ALLOWED"
        ? new RetryNotAllowedError()
        : new ResponseNotFailedError();
    }
    if (decision.kind === "existing") {
      return {
        accepted: {
          conversationId: target.conversationId,
          responseId: responseIdSchema.parse(decision.responseId),
          retryOfResponseId: target.id,
        },
        job: null, // AC-017: the same replacement, no second run
      };
    }
    // Only a genuinely new replacement is gated. A repeated retry returned
    // above, so replaying it remains idempotent even while it is active.
    const active = deps.responses.findActiveByConversation(target.conversationId);
    if (checkActiveResponseGate(active !== null) === "blocked") {
      throw new ResponseAlreadyActiveError();
    }
    // MessageRepo has no findById (SPECS §5.3): take the stored (normalized) content from history.
    const userMessage = deps.messages
      .listByConversation(target.conversationId)
      .find((message) => message.id === target.userMessageId);
    if (userMessage === undefined) {
      throw new Error("Retried user message was not read back");
    }
    const now = deps.clock.now();
    const replacementId = responseIdSchema.parse(deps.ids.next());
    deps.responses.insert({
      id: replacementId,
      conversationId: target.conversationId,
      userMessageId: target.userMessageId,
      retryOfResponseId: target.id,
      createdAt: now,
      updatedAt: now,
    });
    return {
      accepted: {
        conversationId: target.conversationId,
        responseId: replacementId,
        retryOfResponseId: target.id,
      },
      job: {
        responseId: replacementId,
        conversationId: target.conversationId,
        normalizedContent: userMessage.content,
      },
    };
  });

  // After commit; not awaited.
  if (outcome.job !== null) {
    deps.startRun(outcome.job);
  }
  return outcome.accepted;
}
