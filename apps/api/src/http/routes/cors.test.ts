/**
 * SPECS §7.3 (FR-010, AC-023). Exact single-origin CORS over the real server.
 */
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const ORIGIN = "http://localhost:5173";
const FOREIGN = "http://evil.example";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: ORIGIN, logLevel: "fatal" };

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

const preflight = (origin: string, method: string, headers: string, url = "/api/conversations") =>
  app.inject({
    method: "OPTIONS",
    url,
    headers: { origin, "access-control-request-method": method, "access-control-request-headers": headers },
  });

describe("AC-023", () => {
  it("foreign origin gets no access-control-allow-origin, configured origin does", async () => {
    const configured = await app.inject({ method: "GET", url: "/api/conversations", headers: { origin: ORIGIN } });
    expect(configured.statusCode).toBe(200);
    expect(configured.headers["access-control-allow-origin"]).toBe(ORIGIN);

    const foreign = await app.inject({ method: "GET", url: "/api/conversations", headers: { origin: FOREIGN } });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("a foreign preflight returns 204 without access-control-allow-origin; the configured one is allowed", async () => {
    const foreign = await preflight(FOREIGN, "POST", "content-type");
    expect(foreign.statusCode).toBe(204);
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();

    const configured = await preflight(ORIGIN, "POST", "content-type");
    expect(configured.statusCode).toBe(204);
    expect(configured.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(configured.headers["access-control-max-age"]).toBe("600");
    expect(configured.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("the cross-origin SSE preflight allows the last-event-id header (§6.5)", async () => {
    const reply = await preflight(ORIGIN, "GET", "last-event-id", "/api/responses/00000000-0000-4000-8000-000000000001/events");
    expect(reply.statusCode).toBe(204);
    expect(reply.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(String(reply.headers["access-control-allow-headers"]).split(/,\s*/u)).toEqual(expect.arrayContaining(["content-type", "last-event-id"]));
    expect(String(reply.headers["access-control-allow-methods"]).split(/,\s*/u)).toEqual(["GET", "POST", "OPTIONS"]);
  });

  it.each(["http://localhost:5174", "https://localhost:5173", "http://localhost:5173.evil.example", "null"])(
    "a near-miss origin %s is not allowed (exact match, no wildcard/regex/reflection)",
    async (origin) => {
      const reply = await app.inject({ method: "GET", url: "/api/conversations", headers: { origin } });
      expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it("errors from the configured origin still carry the CORS header", async () => {
    const reply = await app.inject({ method: "GET", url: "/api/conversations/not-a-uuid", headers: { origin: ORIGIN } });
    expect(reply.statusCode).toBe(400);
    expect(reply.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });
});
