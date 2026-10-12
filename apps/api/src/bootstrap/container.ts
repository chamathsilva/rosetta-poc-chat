/**
 * Composition root — apps/api/src/bootstrap/container.ts. SPECS §2.2, §5.2,
 * §5.6, §7.1, §7.5 (FR-003, FR-006, FR-011, AC-014).
 *
 * createContainer(config, overrides?) is the only injection seam and the only
 * module that constructs adapters. No env var selects a provider (FR-003):
 * tests substitute provider/clock/ids through `overrides` only.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config/env.js";
import type { ServerDeps } from "../http/server.js";
import { createConversationRepo } from "../persistence/conversation-repo.js";
import { openDatabase } from "../persistence/db.js";
import { createEventRepo } from "../persistence/event-repo.js";
import { createMessageRepo } from "../persistence/message-repo.js";
import { createResponseRepo } from "../persistence/response-repo.js";
import { applySchema } from "../persistence/schema.js";
import { createUnitOfWork } from "../persistence/unit-of-work.js";
import type {
  Clock,
  ConversationRepo,
  EventRepo,
  IdGenerator,
  MessageRepo,
  Provider,
  ResponseRepo,
  UnitOfWork,
} from "../ports.js";
import { createDeterministicProvider } from "../provider/deterministic-provider.js";
import { createStreamHub, type StreamHub } from "../stream/hub.js";
import { recoverActiveResponses } from "../stream/recovery.js";
import { createResponseRunner } from "../stream/runner.js";
import { attachResponseStream } from "../stream/subscribe.js";
import { createConversation } from "../usecases/create-conversation.js";
import { getConversation } from "../usecases/get-conversation.js";
import { listConversations } from "../usecases/list-conversations.js";
import { retryResponse } from "../usecases/retry-response.js";
import { sendMessage, type StartRun } from "../usecases/send-message.js";

export interface ContainerOverrides {
  readonly provider?: Provider;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

/** One in-flight provider run; `promise` always settles and never rejects (SPECS §7.5). */
export interface RunEntry {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

export interface Container {
  readonly db: DatabaseSync;
  readonly uow: UnitOfWork;
  readonly conversations: ConversationRepo;
  readonly messages: MessageRepo;
  readonly responses: ResponseRepo;
  readonly events: EventRepo;
  readonly hub: StreamHub;
  /** In-flight runs: registered on start, removed on settle. */
  readonly registry: ReadonlySet<RunEntry>;
  readonly serverDeps: ServerDeps;
  readonly startRun: StartRun;
  isDraining(): boolean;
  startDraining(): void;
  /** Boot recovery (SPECS §5.6); call once, before listen. Returns the recovered count. */
  recover(): number;
}

export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const db = openDatabase(config.dbPath);
  applySchema(db); // idempotent, at construction (SPECS §5.2)

  const uow = createUnitOfWork(db);
  const conversations = createConversationRepo(db);
  const messages = createMessageRepo(db);
  const responses = createResponseRepo(db);
  const events = createEventRepo(db);
  const hub = createStreamHub();
  const clock: Clock = overrides.clock ?? { now: () => new Date().toISOString() };
  const ids: IdGenerator = overrides.ids ?? { next: () => randomUUID() };
  const provider = overrides.provider ?? createDeterministicProvider();
  const runner = createResponseRunner({
    uow,
    conversations,
    messages,
    responses,
    events,
    clock,
    hub,
    ids,
    provider,
  });

  const registry = new Set<RunEntry>();
  let draining = false;

  // Registers {controller, promise} on start and removes it on settle. runner.run never
  // rejects; the two-sided then still guarantees no unhandled rejection.
  const startRun: StartRun = (job) => {
    const controller = new AbortController();
    const entry: RunEntry = { controller, promise: runner.run(job, controller.signal) };
    registry.add(entry);
    const remove = (): void => {
      registry.delete(entry);
    };
    entry.promise.then(remove, remove);
  };

  const useCaseDeps = { uow, conversations, messages, responses, clock, ids, startRun };
  const healthCheck = db.prepare("SELECT 1 AS ok");

  const serverDeps: ServerDeps = {
    webOrigin: config.webOrigin,
    logLevel: config.logLevel,
    isDraining: () => draining,
    checkDatabase: () => db.isOpen && healthCheck.get() !== undefined,
    createConversation: () => createConversation(useCaseDeps),
    listConversations: () => listConversations(useCaseDeps),
    getConversation: (conversationId) => getConversation(useCaseDeps, conversationId),
    sendMessage: (input) => sendMessage(useCaseDeps, input),
    retryResponse: (responseId) => retryResponse(useCaseDeps, responseId),
    responseEvents: {
      exists: (responseId) => responses.findById(responseId) !== null,
      maxSeq: (responseId) => events.maxSeq(responseId),
      attach: (responseId, lastEventId, sink) =>
        attachResponseStream({ hub, events }, responseId, lastEventId, sink),
    },
  };

  return {
    db,
    uow,
    conversations,
    messages,
    responses,
    events,
    hub,
    registry,
    serverDeps,
    startRun,
    isDraining: () => draining,
    startDraining() {
      draining = true;
    },
    recover: () => recoverActiveResponses({ uow, conversations, responses, events, clock }),
  };
}
