/**
 * SPECS §5.2, §5.3, §5.4 (FR-006, FR-010, AC-008, AC-009, AC-010, AC-017). The
 * database is the hard invariant: each unique index holds even when the
 * application guard is bypassed with raw SQL, and a corrupt row read back is
 * refused rather than turned into a domain object.
 */
import {
  messageIdSchema,
  responseIdSchema,
  type ConversationId,
  type MessageId,
  type ResponseId,
} from "@rosetta-poc/chat-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { IllegalResponseStateError, PersistedRecordInvalidError } from "../domain/errors.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { closeDatabase } from "./db.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };

let c: Container;
let seedIds = sequentialIds("f");
beforeEach(() => {
  c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a") });
  seedIds = sequentialIds("f");
});
afterEach(async () => {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
  closeDatabase(c.db);
});

interface Seeded {
  readonly conversationId: ConversationId;
  readonly userMessageId: MessageId;
  readonly responseId: ResponseId;
}

/** A conversation with one user message and a pending response, written through the repositories (no provider run). */
function seedPending(key = "k-1", content = "hello"): Seeded {
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const userMessageId = messageIdSchema.parse(seedIds.next());
  const responseId = responseIdSchema.parse(seedIds.next());
  c.uow.run(() => {
    c.messages.insert({ id: userMessageId, conversationId, role: "user", content, clientMessageId: key, createdAt: T0 });
    c.responses.insert({ id: responseId, conversationId, userMessageId, retryOfResponseId: null, createdAt: T0, updatedAt: T0 });
  });
  return { conversationId, userMessageId, responseId };
}

const count = (table: "messages" | "responses"): number =>
  (c.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("unique indexes are the hard invariants", () => {
  it("ux_messages_idempotency: a second (conversation, clientMessageId) insert is rejected", () => {
    const { conversationId } = seedPending("k-1");
    expect(() =>
      c.db
        .prepare("INSERT INTO messages (id, conversation_id, seq, role, content, client_message_id, created_at) VALUES (?, ?, 99, 'user', 'x', 'k-1', ?)")
        .run("m-raw", conversationId, T0),
    ).toThrow(/UNIQUE constraint failed: messages.conversation_id, messages.client_message_id/);
    expect(count("messages")).toBe(1);
  });

  it("the idempotency key is scoped per conversation; NULL keys are never unique-constrained", () => {
    seedPending("k-1");
    const other = c.serverDeps.createConversation().conversation.id;
    const insert = c.db.prepare(
      "INSERT INTO messages (id, conversation_id, seq, role, content, client_message_id, created_at) VALUES (?, ?, ?, ?, 'x', ?, ?)",
    );
    insert.run("m-x", other, 1, "user", "k-1", T0);
    insert.run("m-y", other, 2, "assistant", null, T0);
    insert.run("m-z", other, 3, "assistant", null, T0);
    expect(count("messages")).toBe(4);
  });

  it("ux_responses_one_active_per_conversation: a second pending response in the same conversation is rejected", () => {
    const { conversationId, userMessageId } = seedPending();
    expect(() =>
      c.db
        .prepare("INSERT INTO responses (id, conversation_id, user_message_id, status, created_at, updated_at) VALUES ('r-raw', ?, ?, 'pending', ?, ?)")
        .run(conversationId, userMessageId, T0, T0),
    ).toThrow(/UNIQUE constraint failed: responses.conversation_id/);
    expect(count("responses")).toBe(1);
  });

  it("ux_responses_retry_of: a response can have at most one replacement", () => {
    const { conversationId, userMessageId, responseId } = seedPending();
    c.db.prepare("UPDATE responses SET status = 'failed' WHERE id = ?").run(responseId);
    const insert = c.db.prepare(
      "INSERT INTO responses (id, conversation_id, user_message_id, status, retry_of_response_id, created_at, updated_at) VALUES (?, ?, ?, 'failed', ?, ?, ?)",
    );
    insert.run("r-repl-1", conversationId, userMessageId, responseId, T0, T0);
    expect(() => insert.run("r-repl-2", conversationId, userMessageId, responseId, T0, T0)).toThrow(
      /UNIQUE constraint failed: responses.retry_of_response_id/,
    );
  });

  it("ux_stream_events_terminal: a second terminal event is rejected by the index even when the guard is bypassed", () => {
    const { conversationId, responseId } = seedPending();
    const assistantMessageId = messageIdSchema.parse(seedIds.next());
    c.uow.run(() => {
      c.events.append(responseId, "response.started", { responseId, conversationId }, T0);
      c.responses.updateStatus(responseId, "streaming", T0);
      c.events.append(
        responseId,
        "response.completed",
        {
          responseId,
          assistantMessage: { id: assistantMessageId, conversationId, seq: 2, role: "assistant", content: "", clientMessageId: null, createdAt: T0 },
        },
        T0,
      );
    });
    // The domain guard rejects first …
    expect(() =>
      c.uow.run(() =>
        c.events.append(responseId, "response.failed", { responseId, failure: { code: "PROVIDER_ERROR", message: "x" } }, T0),
      ),
    ).toThrow(IllegalResponseStateError);
    // … and the index holds behind it.
    expect(() =>
      c.db.prepare("INSERT INTO stream_events (response_id, seq, type, data, created_at) VALUES (?, 9, 'response.failed', '{}', ?)").run(responseId, T0),
    ).toThrow(/UNIQUE constraint failed: stream_events.response_id/);
    expect(c.events.maxSeq(responseId)).toBe(2);
  });
});

describe("event appends (§5.3 single write path)", () => {
  it("allocates seq 1..n per response and refuses to run outside a transaction", () => {
    const { conversationId, responseId } = seedPending();
    expect(() => c.events.append(responseId, "response.started", { responseId, conversationId }, T0)).toThrow(/inside a UnitOfWork/);
    c.uow.run(() => {
      c.events.append(responseId, "response.started", { responseId, conversationId }, T0);
      c.responses.updateStatus(responseId, "streaming", T0);
      c.events.append(responseId, "response.delta", { responseId, text: "a" }, T0);
      c.events.append(responseId, "response.delta", { responseId, text: "b" }, T0);
    });
    expect(c.events.listAfter(responseId, 0).map((e) => [e.seq, e.type])).toEqual([
      [1, "response.started"],
      [2, "response.delta"],
      [3, "response.delta"],
    ]);
    expect(c.events.listAfter(responseId, 2).map((e) => e.seq)).toEqual([3]);
  });
});

describe("row re-validation (§5.4)", () => {
  it("a corrupt response row is refused with PersistedRecordInvalidError, never echoing the bad value", () => {
    const { responseId } = seedPending();
    c.db.prepare("UPDATE responses SET created_at = 'not-a-timestamp-SECRET' WHERE id = ?").run(responseId);
    let caught: unknown;
    try {
      c.responses.findById(responseId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PersistedRecordInvalidError);
    expect(String(caught instanceof Error ? caught.message : caught)).not.toContain("SECRET");
  });

  it("corrupt event data is refused", () => {
    const { conversationId, responseId } = seedPending();
    c.uow.run(() => c.events.append(responseId, "response.started", { responseId, conversationId }, T0));
    c.db.prepare("UPDATE stream_events SET data = '{\"responseId\":\"x\"}' WHERE response_id = ?").run(responseId);
    expect(() => c.events.listAfter(responseId, 0)).toThrow(PersistedRecordInvalidError);
  });
});
