/**
 * SPECS §3.4, §3.4a, §4.3, §4.5, §10 (FR-008, AC-017, A-003). Retry over the
 * real server. A scripted provider fails runs 1–2 and keeps run 3 active until
 * released, so the active-response gate meets a genuinely active response.
 */
import { errorEnvelopeSchema, retryAcceptedSchema, sendMessageAcceptedSchema, type ResponseId } from "@rosetta-poc/chat-shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../../bootstrap/container.js";
import type { AppConfig } from "../../config/env.js";
import { closeDatabase } from "../../persistence/db.js";
import type { Provider } from "../../ports.js";
import { createDeterministicProvider } from "../../provider/deterministic-provider.js";
import { failingProvider } from "../../testing/provider-doubles.js";
import { fakeClock } from "../../testing/fake-clock.js";
import { sequentialIds } from "../../testing/sequential-ids.js";
import { buildServer } from "../server.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;

const owned: { c: Container; app: FastifyInstance; release: () => void }[] = [];
afterEach(async () => {
  for (const { c, app, release } of owned.splice(0)) {
    release(); // registered at setup, so it runs even if the test failed before releasing
    await app.close();
    for (const entry of c.registry) entry.controller.abort();
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    closeDatabase(c.db);
  }
});

/** Runs listed in `failing` fail; run `gatedRun` (if any) waits for release; all others succeed. */
function scripted(failing: readonly number[], gatedRun = 0) {
  let runs = 0;
  let release!: () => void;
  let signal!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { signal = resolve; });
  const ok = createDeterministicProvider();
  const fail = failingProvider("PROVIDER_ERROR");
  const provider: Provider = {
    stream(input) {
      runs += 1;
      if (failing.includes(runs)) return fail.stream(input);
      if (runs === gatedRun) {
        return (async function* () {
          yield { kind: "delta" as const, text: "Mock " };
          signal();
          await gate;
          yield { kind: "end" as const };
        })();
      }
      return ok.stream(input);
    },
  };
  return { provider, reached, release };
}

function setup(failing: readonly number[], gatedRun = 0) {
  const script = scripted(failing, gatedRun);
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), provider: script.provider });
  const app = buildServer(c.serverDeps);
  owned.push({ c, app, release: script.release });
  const conversationId = c.serverDeps.createConversation().conversation.id;
  return { c, app, conversationId, script };
}

const snapshot = (c: Container) =>
  Object.fromEntries(TABLES.map((t) => [t, c.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
const settle = async (c: Container) => {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
};
const retry = (app: FastifyInstance, id: string) => app.inject({ method: "POST", url: `/api/responses/${id}/retry` });

async function send(app: FastifyInstance, conversationId: string, key: string, content: string) {
  const reply = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/messages`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ clientMessageId: key, content }),
  });
  expect(reply.statusCode).toBe(202);
  return sendMessageAcceptedSchema.parse(reply.json());
}

describe("retry over HTTP", () => {
  it("first retry ⇒ 202 replacement; second retry ⇒ 202 with the same replacement, one user message, zero writes", async () => {
    const { c, app, conversationId } = setup([1]);
    const original = (await send(app, conversationId, "k-1", "retry me")).response.id;
    await settle(c);
    const first = await retry(app, original);
    expect(first.statusCode).toBe(202);
    const accepted = retryAcceptedSchema.parse(first.json());
    expect(accepted).toMatchObject({ conversationId, retryOfResponseId: original });
    await settle(c);
    const before = snapshot(c);
    const second = await retry(app, original);
    expect(second.statusCode).toBe(202);
    expect(retryAcceptedSchema.parse(second.json())).toEqual(accepted);
    expect(snapshot(c)).toEqual(before);
    expect(c.serverDeps.getConversation(conversationId).messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it.each([
    ["retry of a completed response", "completed", 409, "RESPONSE_NOT_FAILED"],
    ["retry of a replacement", "replacement", 409, "RETRY_NOT_ALLOWED"],
    ["unknown response", "unknown", 404, "NOT_FOUND"],
    ["non-UUID response id", "not-a-uuid", 400, "VALIDATION_FAILED"],
  ] as const)("%s ⇒ %i %s, zero writes", async (_label, target, status, code) => {
    const { c, app, conversationId } = setup(target === "replacement" ? [1, 2] : []);
    const sent = (await send(app, conversationId, "k-1", "x")).response.id;
    await settle(c);
    let id: string = sent;
    if (target === "replacement") {
      id = retryAcceptedSchema.parse((await retry(app, sent)).json()).responseId;
      await settle(c);
      expect(c.responses.findById(id as ResponseId)?.status).toBe("failed"); // fixture: a FAILED replacement
    } else if (target === "unknown") {
      id = "00000000-0000-4000-8000-00000000ffff";
    } else if (target === "not-a-uuid") {
      id = "not-a-uuid";
    }
    const before = snapshot(c);
    const reply = await retry(app, id);
    expect(reply.statusCode).toBe(status);
    expect(errorEnvelopeSchema.parse(reply.json()).error.code).toBe(code);
    expect(snapshot(c)).toEqual(before);
  });

  it("retrying a failed response while a different response in the conversation is active returns 409 RESPONSE_ALREADY_ACTIVE with zero writes, while replaying an existing active retry still returns 202 with that replacement", async () => {
    // Run 1 (X) fails, run 2 (Y) fails, run 3 (X's replacement) stays active until released.
    const { c, app, conversationId, script } = setup([1, 2], 3);
    const x = (await send(app, conversationId, "k-x", "first")).response.id;
    await settle(c);
    const y = (await send(app, conversationId, "k-y", "second")).response.id;
    await settle(c);
    const xRetry = await retry(app, x);
    expect(xRetry.statusCode).toBe(202);
    const replacement = retryAcceptedSchema.parse(xRetry.json());
    await script.reached;
    expect(c.responses.findActiveByConversation(conversationId)?.id).toBe(replacement.responseId); // fixture check

    const before = snapshot(c);
    const blocked = await retry(app, y);
    expect(blocked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(blocked.json()).error.code).toBe("RESPONSE_ALREADY_ACTIVE");
    expect(snapshot(c)).toEqual(before);

    const replay = await retry(app, x);
    expect(replay.statusCode).toBe(202);
    expect(retryAcceptedSchema.parse(replay.json())).toEqual(replacement);
    expect(snapshot(c)).toEqual(before);

    script.release();
    await settle(c);
    expect(c.responses.findById(replacement.responseId)?.status).toBe("completed");
  });
});
