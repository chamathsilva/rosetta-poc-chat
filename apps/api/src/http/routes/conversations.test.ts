/**
 * SPECS §4.1, §4.3, §10 (FR-002, FR-010, AC-004, AC-019). Conversation routes
 * over the real server: status codes, shared-schema bodies, and errors.
 */
import {
  createConversationResponseSchema,
  errorEnvelopeSchema,
  getConversationResponseSchema,
  listConversationsResponseSchema,
} from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };

let c: Container;
let app: FastifyInstance;
beforeEach(() => {
  c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a") });
  app = buildServer(c.serverDeps);
});
afterEach(async () => {
  await app.close();
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
  closeDatabase(c.db);
});

const conversationCount = (): number => (c.db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n;

describe("POST /api/conversations", () => {
  it.each([
    ["no body", undefined, undefined],
    ["an empty JSON body", "", "application/json"],
    ["{}", "{}", "application/json"],
  ])("with %s ⇒ 201 { conversation } with the placeholder title", async (_label, payload, contentType) => {
    const reply = await app.inject({
      method: "POST",
      url: "/api/conversations",
      ...(payload === undefined ? {} : { payload, headers: { "content-type": contentType ?? "" } }),
    });
    expect(reply.statusCode).toBe(201);
    const body = createConversationResponseSchema.parse(reply.json());
    expect(body.conversation).toMatchObject({ title: "New conversation", createdAt: T0, updatedAt: T0 });
  });

  it.each([
    ["an unknown field (strict)", '{"title":"x"}'],
    ["malformed JSON", "{"],
  ])("with %s ⇒ 400 VALIDATION_FAILED, nothing created", async (_label, payload) => {
    const reply = await app.inject({ method: "POST", url: "/api/conversations", payload, headers: { "content-type": "application/json" } });
    expect(reply.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe("VALIDATION_FAILED");
    expect(conversationCount()).toBe(0);
  });
});

describe("GET /api/conversations and /api/conversations/:id", () => {
  it("list ⇒ 200 { conversations } newest first; get ⇒ 200 detail", async () => {
    const a = createConversationResponseSchema.parse((await app.inject({ method: "POST", url: "/api/conversations" })).json()).conversation;
    const b = createConversationResponseSchema.parse((await app.inject({ method: "POST", url: "/api/conversations" })).json()).conversation;
    const list = await app.inject({ method: "GET", url: "/api/conversations" });
    expect(list.statusCode).toBe(200);
    expect(listConversationsResponseSchema.parse(list.json()).conversations.map((s) => s.id)).toEqual([b.id, a.id]);

    const get = await app.inject({ method: "GET", url: `/api/conversations/${a.id}` });
    expect(get.statusCode).toBe(200);
    expect(getConversationResponseSchema.parse(get.json())).toEqual({ conversation: a, messages: [], responses: [], activeResponse: null });
  });

  it.each([
    ["an unknown id", "00000000-0000-4000-8000-00000000ffff", 404, "NOT_FOUND"],
    ["a non-UUID id", "not-a-uuid", 400, "VALIDATION_FAILED"],
  ] as const)("get with %s ⇒ %i %s", async (_label, id, status, code) => {
    const reply = await app.inject({ method: "GET", url: `/api/conversations/${id}` });
    expect(reply.statusCode).toBe(status);
    expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe(code);
  });

  it("an unknown route ⇒ 404 NOT_FOUND envelope", async () => {
    const reply = await app.inject({ method: "GET", url: "/api/nope" });
    expect(reply.statusCode).toBe(404);
    expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe("NOT_FOUND");
  });
});
