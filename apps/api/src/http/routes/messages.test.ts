/**
 * SPECS §3.4a, §4.3, §4.4, §4.6, §10 (FR-002, FR-009, FR-010, AC-008, AC-009,
 * AC-019). The real server (buildServer) over a real container, via inject.
 */
import { errorEnvelopeSchema, sendMessageAcceptedSchema } from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container, type ContainerOverrides } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import type { ProviderChunk } from "../../ports.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;
const UNKNOWN = "00000000-0000-4000-8000-00000000ffff";

const owned: { c: Container; app: FastifyInstance }[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  // On failure too: open every gate and abort every in-flight run, so settlement can never hang.
  for (const release of releases.splice(0)) release();
  for (const { c, app } of owned.splice(0)) {
    await app.close();
    for (const entry of c.registry) entry.controller.abort();
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    closeDatabase(c.db);
  }
});

function setup(overrides: ContainerOverrides = {}) {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), ...overrides });
  const app = buildServer(c.serverDeps);
  owned.push({ c, app });
  const conversationId = c.serverDeps.createConversation().conversation.id;
  return { c, app, conversationId };
}

const snapshot = (c: Container) =>
  Object.fromEntries(TABLES.map((t) => [t, c.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
const settle = async (c: Container) => {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
};

function post(app: FastifyInstance, path: string, payload?: string | object, contentType = "application/json") {
  return app.inject({
    method: "POST",
    url: path,
    ...(payload === undefined ? {} : { payload: typeof payload === "string" ? payload : JSON.stringify(payload), headers: { "content-type": contentType } }),
  });
}

describe("§10 error-category table over HTTP (AC-019)", () => {
  const cases: ReadonlyArray<readonly [string, (id: string) => string, string | object, number, string]> = [
    ["malformed JSON body", (id) => `/api/conversations/${id}/messages`, '{"clientMessageId":', 400, "VALIDATION_FAILED"],
    ["missing clientMessageId", (id) => `/api/conversations/${id}/messages`, { content: "hi" }, 400, "VALIDATION_FAILED"],
    ["extra unknown field (.strict())", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k", content: "hi", role: "system" }, 400, "VALIDATION_FAILED"],
    ["non-UUID path param", () => "/api/conversations/not-a-uuid/messages", { clientMessageId: "k", content: "hi" }, 400, "VALIDATION_FAILED"],
    ["unknown conversation", () => `/api/conversations/${UNKNOWN}/messages`, { clientMessageId: "k", content: "hi" }, 404, "NOT_FOUND"],
    ["empty content", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k", content: "" }, 400, "VALIDATION_FAILED"],
    ["whitespace-only content", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k", content: "   " }, 400, "VALIDATION_FAILED"],
    ["newline/tab/space content", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k", content: "\n\t " }, 400, "VALIDATION_FAILED"],
    ["4001 code points", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k", content: "x".repeat(4001) }, 400, "VALIDATION_FAILED"],
    ["clientMessageId of length 0", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "", content: "hi" }, 400, "VALIDATION_FAILED"],
    ["clientMessageId of length 129", (id) => `/api/conversations/${id}/messages`, { clientMessageId: "k".repeat(129), content: "hi" }, 400, "VALIDATION_FAILED"],
  ];

  it.each(cases)("%s ⇒ %i %s, enveloped, zero writes", async (_label, path, payload, status, code) => {
    const { c, app, conversationId } = setup();
    const before = snapshot(c);
    const reply = await post(app, path(conversationId), payload);
    expect(reply.statusCode).toBe(status);
    const envelope = errorEnvelopeSchema.parse(reply.json());
    expect(envelope.error.code).toBe(code);
    expect(snapshot(c)).toEqual(before);
    expect(c.registry.size).toBe(0);
  });

  it.each([
    ["single word", "hello"],
    ["multi word", "hello big world"],
    ["inner double spaces and a newline", "hello  big\nworld"],
    ["unicode (emoji + CJK)", "héllo 😀 世界"],
    ["exactly 4000 code points", "x".repeat(4000)],
    ["4000 surrogate-pair code points (UTF-16 length 8000)", "😀".repeat(4000)],
  ])("happy %s ⇒ 202 with the trimmed content stored", async (_label, content) => {
    const { c, app, conversationId } = setup();
    const reply = await post(app, `/api/conversations/${conversationId}/messages`, { clientMessageId: "k", content: `  ${content}\n` });
    expect(reply.statusCode).toBe(202);
    expect(sendMessageAcceptedSchema.parse(reply.json()).userMessage.content).toBe(content);
    await settle(c);
  });

  it.each([1, 128])("clientMessageId of length %i ⇒ 202", async (length) => {
    const { c, app, conversationId } = setup();
    const reply = await post(app, `/api/conversations/${conversationId}/messages`, { clientMessageId: "k".repeat(length), content: "hi" });
    expect(reply.statusCode).toBe(202);
    await settle(c);
  });
});

describe("idempotency over HTTP", () => {
  it("duplicate key ⇒ 202 with the original ids; same key different content ⇒ 409 and zero stored change", async () => {
    const { c, app, conversationId } = setup();
    const path = `/api/conversations/${conversationId}/messages`;
    const first = sendMessageAcceptedSchema.parse((await post(app, path, { clientMessageId: "k-1", content: "original" })).json());
    await settle(c);
    const duplicate = await post(app, path, { clientMessageId: "k-1", content: "  original  " });
    expect(duplicate.statusCode).toBe(202);
    const replay = sendMessageAcceptedSchema.parse(duplicate.json());
    expect(replay.userMessage).toEqual(first.userMessage);
    expect(replay.response.id).toBe(first.response.id);

    const before = snapshot(c);
    const conflict = await post(app, path, { clientMessageId: "k-1", content: "different" });
    expect(conflict.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(snapshot(c)).toEqual(before);
  });
});

describe("one active response per conversation (§3.4a)", () => {
  it("sending while the conversation has an active response returns 409 RESPONSE_ALREADY_ACTIVE with zero writes; re-sending the original active response's own clientMessageId still returns 202 with the original IDs", async () => {
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    releases.push(() => release());
    const { c, app, conversationId } = setup({
      provider: {
        async *stream(): AsyncGenerator<ProviderChunk> {
          yield { kind: "delta", text: "Mock " };
          signal();
          await gate;
          yield { kind: "end" };
        },
      },
    });
    const path = `/api/conversations/${conversationId}/messages`;
    const first = sendMessageAcceptedSchema.parse((await post(app, path, { clientMessageId: "k-1", content: "first" })).json());
    await reached;
    expect(c.responses.findActiveByConversation(conversationId)?.id).toBe(first.response.id); // fixture check

    const before = snapshot(c);
    const blocked = await post(app, path, { clientMessageId: "k-2", content: "second" });
    expect(blocked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(blocked.json()).error.code).toBe("RESPONSE_ALREADY_ACTIVE");
    expect(snapshot(c)).toEqual(before);

    const replay = await post(app, path, { clientMessageId: "k-1", content: "first" });
    expect(replay.statusCode).toBe(202);
    const body = sendMessageAcceptedSchema.parse(replay.json());
    expect(body.userMessage.id).toBe(first.userMessage.id);
    expect(body.response.id).toBe(first.response.id);
    expect(snapshot(c)).toEqual(before);

    release();
    await settle(c);
    expect(c.responses.findById(first.response.id)?.status).toBe("completed");
  });
});
