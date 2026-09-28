/**
 * Response runner — apps/api/src/stream/runner.ts. SPECS §2.2, §3.5, §5.6,
 * §6.2, §7.5 (FR-003, FR-004, FR-008, AC-003, AC-010, AC-016).
 *
 * persist-then-emit: every provider chunk is committed through
 * EventRepo.append in its own UnitOfWork transaction, and only then published
 * to the hub. Never the reverse. run() never rejects: any thrown value maps to
 * PROVIDER_ERROR, an abort maps to PROVIDER_INTERRUPTED, and both take the
 * same failure-append path, so a shutdown registry's promise always settles.
 */
import { messageIdSchema } from "@rosetta-poc/chat-shared";
import { IllegalResponseStateError, NotFoundError } from "../domain/errors.js";
import { isTerminalStatus } from "../domain/response-machine.js";
import type { ConversationId, Message, PersistedEvent, ResponseId } from "../domain/types.js";
import type {
  Clock,
  ConversationRepo,
  EventRepo,
  IdGenerator,
  MessageRepo,
  Provider,
  ProviderChunk,
  ResponseRepo,
  UnitOfWork,
} from "../ports.js";
import { PROVIDER_FAILURE_MESSAGES, type ProviderFailureCode } from "../provider/types.js";
import type { StreamHub } from "./hub.js";

export interface FailDeps {
  readonly uow: UnitOfWork;
  readonly conversations: ConversationRepo;
  readonly responses: ResponseRepo;
  readonly events: EventRepo;
  readonly clock: Clock;
}

export interface RunnerDeps extends FailDeps {
  readonly messages: MessageRepo;
  readonly hub: StreamHub;
  readonly ids: IdGenerator;
  readonly provider: Provider;
}

export interface RunJob {
  readonly responseId: ResponseId;
  readonly conversationId: ConversationId;
  readonly normalizedContent: string;
}

export interface ResponseRunner {
  run(job: RunJob, signal: AbortSignal): Promise<void>;
}

/**
 * One transaction: move a non-terminal response to failed with exactly one
 * terminal event. A response with no events first gets response.started,
 * because checkAppend rejects a terminal event at seq 1 (SPECS §5.6).
 * partial_text is left untouched. Returns the appended events, in seq order,
 * for the caller to publish; [] when the response is already terminal.
 */
export function failResponse(
  deps: FailDeps,
  responseId: ResponseId,
  code: ProviderFailureCode,
): readonly PersistedEvent[] {
  return deps.uow.run(() => {
    const record = deps.responses.findById(responseId);
    if (record === null || isTerminalStatus(record.status)) {
      return [];
    }
    const now = deps.clock.now();
    const failure = { code, message: PROVIDER_FAILURE_MESSAGES[code] };
    const appended: PersistedEvent[] = [];
    if (deps.events.maxSeq(responseId) === 0) {
      appended.push(
        deps.events.append(
          responseId,
          "response.started",
          { responseId, conversationId: record.conversationId },
          now,
        ),
      );
    }
    appended.push(deps.events.append(responseId, "response.failed", { responseId, failure }, now));
    deps.responses.setFailed(responseId, code, failure.message, now);
    deps.conversations.touch(record.conversationId, now);
    return appended;
  });
}

/** A promise that rejects when signal aborts; dispose() removes the listener. */
function rejectOnAbort(signal: AbortSignal): { promise: Promise<never>; dispose(): void } {
  let onAbort = (): void => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  promise.catch(() => {});
  return {
    promise,
    dispose() {
      signal.removeEventListener("abort", onAbort);
    },
  };
}

export function createResponseRunner(deps: RunnerDeps): ResponseRunner {
  function start(job: RunJob): PersistedEvent {
    return deps.uow.run(() => {
      const now = deps.clock.now();
      const event = deps.events.append(
        job.responseId,
        "response.started",
        { responseId: job.responseId, conversationId: job.conversationId },
        now,
      );
      deps.responses.updateStatus(job.responseId, "streaming", now);
      return event;
    });
  }

  function appendDelta(job: RunJob, text: string): PersistedEvent {
    return deps.uow.run(() => {
      const event = deps.events.append(
        job.responseId,
        "response.delta",
        { responseId: job.responseId, text },
        deps.clock.now(),
      );
      deps.responses.appendPartialText(job.responseId, text);
      return event;
    });
  }

  /** Assistant message content = partial_text, the concatenation of applied deltas (SPECS §6.2). */
  function complete(job: RunJob): PersistedEvent {
    return deps.uow.run(() => {
      const now = deps.clock.now();
      const record = deps.responses.findById(job.responseId);
      if (record === null) {
        throw new NotFoundError("response");
      }
      const assistantMessageId = messageIdSchema.parse(deps.ids.next());
      deps.messages.insert({
        id: assistantMessageId,
        conversationId: job.conversationId,
        role: "assistant",
        content: record.partialText,
        clientMessageId: null,
        createdAt: now,
      });
      // MessageRepo has no findById (SPECS §5.3); read the inserted row back to get its seq.
      const assistantMessage: Message | undefined = deps.messages
        .listByConversation(job.conversationId)
        .find((message) => message.id === assistantMessageId);
      if (assistantMessage === undefined) {
        throw new Error("Inserted assistant message was not read back");
      }
      const event = deps.events.append(
        job.responseId,
        "response.completed",
        { responseId: job.responseId, assistantMessage },
        now,
      );
      deps.responses.setCompleted(job.responseId, assistantMessageId, now);
      deps.conversations.touch(job.conversationId, now);
      return event;
    });
  }

  /** Returns null on completion, else the failure code to record. */
  async function consume(job: RunJob, signal: AbortSignal): Promise<ProviderFailureCode | null> {
    const iterator = deps.provider
      .stream({ responseId: job.responseId, normalizedContent: job.normalizedContent })
      [Symbol.asyncIterator]();
    const abort = rejectOnAbort(signal);
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = iterator.next();
        next.catch(() => {}); // abort may win the race; never leave next() unhandled
        const result: IteratorResult<ProviderChunk> = await Promise.race([next, abort.promise]);
        if (result.done === true) {
          return "PROVIDER_ERROR"; // the stream ended without an end chunk
        }
        const chunk = result.value;
        if (chunk.kind === "delta") {
          deps.hub.publish(appendDelta(job, chunk.text));
        } else if (chunk.kind === "end") {
          deps.hub.publish(complete(job));
          return null;
        } else {
          return chunk.code; // chunk.message is never exposed (AC-021)
        }
      }
    } finally {
      abort.dispose();
      iterator.return?.()?.catch(() => {});
    }
  }

  return {
    async run(job, signal) {
      let code: ProviderFailureCode;
      try {
        signal.throwIfAborted();
        deps.hub.publish(start(job));
        const failed = await consume(job, signal);
        if (failed === null) {
          return;
        }
        code = failed;
      } catch (error) {
        if (error instanceof IllegalResponseStateError && error.reason === "already-started") {
          return; // another run owns this response; never fail it from here
        }
        code = signal.aborted ? "PROVIDER_INTERRUPTED" : "PROVIDER_ERROR";
      }
      try {
        for (const event of failResponse(deps, job.responseId, code)) {
          deps.hub.publish(event);
        }
      } catch {
        // E.g. the DB closed after a shutdown drain timeout: the response stays
        // active, and boot recovery (SPECS §5.6) fails it on the next start.
      }
    },
  };
}
