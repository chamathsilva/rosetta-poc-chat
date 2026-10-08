/**
 * SPECS §4.3 (/health), §7.5 step 1 (FR-002, FR-011). Health is not enveloped;
 * draining refuses POST routes and new event streams but still serves reads.
 */
import { errorEnvelopeSchema, healthResponseSchema } from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };

let c: Container;
let app: FastifyInstance;
beforeEach(() => {
  c = createContainer(config, { clock: fakeClock("2026-09-28T10:00:00.000Z"), ids: sequentialIds("a") });
  app = buildServer(c.serverDeps);
});
afterEach(async () => {
  await app.close();
  closeDatabase(c.db);
});

describe("GET /health", () => {
  it("200 { status: ok, database: ok } on a live database", async () => {
    const reply = await app.inject({ method: "GET", url: "/health" });
    expect(reply.statusCode).toBe(200);
    expect(healthResponseSchema.parse(reply.json())).toEqual({ status: "ok", database: "ok" });
  });

  it("503 { status: unavailable, database: error } when the database handle is closed", async () => {
    closeDatabase(c.db);
    const reply = await app.inject({ method: "GET", url: "/health" });
    expect(reply.statusCode).toBe(503);
    expect(healthResponseSchema.parse(reply.json())).toEqual({ status: "unavailable", database: "error" });
  });
});

describe("draining (§7.5 step 1)", () => {
  it("health 503 unavailable, POST and new event streams 503 SERVICE_UNAVAILABLE, reads still 200", async () => {
    const conversationId = c.serverDeps.createConversation().conversation.id;
    c.startDraining();

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(503);
    expect(health.json()).toEqual({ status: "unavailable", database: "ok" });

    for (const request of [
      { method: "POST" as const, url: "/api/conversations" },
      { method: "POST" as const, url: `/api/conversations/${conversationId}/messages`, payload: { clientMessageId: "k", content: "hi" } },
      { method: "POST" as const, url: "/api/responses/00000000-0000-4000-8000-000000000001/retry" },
      { method: "GET" as const, url: "/api/responses/00000000-0000-4000-8000-000000000001/events" },
    ]) {
      const reply = await app.inject(request);
      expect(reply.statusCode, `${request.method} ${request.url}`).toBe(503);
      expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    }

    expect((await app.inject({ method: "GET", url: "/api/conversations" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/conversations/${conversationId}` })).statusCode).toBe(200);
    expect((c.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n).toBe(0);
  });
});
