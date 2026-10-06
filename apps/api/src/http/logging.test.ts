/**
 * SPECS §7.4 (FR-011, AC-021, A-006). The real server (buildServer: logger,
 * error handler, per-response line) runs with stub use cases; pino's output is
 * captured at the fs layer sonic-boom writes through. Every captured line may
 * carry only allowlisted fields, and no line for a send may contain the
 * content or any substring of it longer than 3 characters.
 */
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { SendMessageAccepted } from "@rosetta-poc/chat-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOG_FIELD_ALLOWLIST, pickLogFields } from "./logging.js";
import { buildServer, type ServerDeps } from "./server.js";

const CONTENT = "Xylophone quokka zebra marmalade";
const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const T = "2026-09-27T10:00:00.000Z";
const LINE_KEYS = new Set<string>(["level", "time", "msg", ...LOG_FIELD_ALLOWLIST]);

const accepted: SendMessageAccepted = {
  conversationId: C as SendMessageAccepted["conversationId"],
  userMessage: {
    id: M as SendMessageAccepted["userMessage"]["id"],
    conversationId: C as SendMessageAccepted["conversationId"],
    seq: 1,
    role: "user",
    content: CONTENT,
    clientMessageId: "k-1",
    createdAt: T,
  },
  response: {
    id: R as SendMessageAccepted["response"]["id"],
    conversationId: C as SendMessageAccepted["conversationId"],
    userMessageId: M as SendMessageAccepted["userMessage"]["id"],
    assistantMessageId: null,
    status: "pending",
    partialText: "",
    failure: null,
    retryOfResponseId: null,
    retriedByResponseId: null,
    createdAt: T,
    updatedAt: T,
  },
};

const unused = (): never => {
  throw new Error("not used in this test");
};

function deps(sendMessage: ServerDeps["sendMessage"]): ServerDeps {
  return {
    webOrigin: "http://localhost:5173",
    logLevel: "trace",
    isDraining: () => false,
    checkDatabase: () => true,
    createConversation: unused,
    listConversations: unused,
    getConversation: unused,
    sendMessage,
    retryResponse: unused,
    responseEvents: { exists: () => false, maxSeq: () => 0, attach: unused },
  };
}

let captured: string[] = [];

beforeEach(() => {
  captured = [];
  const record = (data: unknown): number => {
    const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
    captured.push(text);
    return Buffer.byteLength(text);
  };
  vi.spyOn(fs, "writeSync").mockImplementation(((_fd: number, data: unknown) => record(data)) as typeof fs.writeSync);
  vi.spyOn(fs, "write").mockImplementation(((_fd: number, data: unknown, ...rest: unknown[]) => {
    const written = record(data);
    const callback = rest.at(-1);
    if (typeof callback === "function") {
      process.nextTick(callback, null, written);
    }
  }) as typeof fs.write);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle(app: FastifyInstance): Promise<Record<string, unknown>[]> {
  await app.close();
  await new Promise((resolve) => setImmediate(resolve));
  return captured
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function substringsLongerThan3(text: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i + 4 <= text.length; i++) grams.push(text.slice(i, i + 4));
  return grams;
}

function assertNoContent(lines: readonly Record<string, unknown>[]): void {
  const all = lines.map((line) => JSON.stringify(line)).join("\n");
  expect(all).not.toContain(CONTENT);
  for (const gram of substringsLongerThan3(CONTENT)) {
    expect(all, `log output contains content fragment ${JSON.stringify(gram)}`).not.toContain(gram);
  }
}

function assertAllowlisted(lines: readonly Record<string, unknown>[]): void {
  for (const line of lines) {
    for (const key of Object.keys(line)) {
      expect(LINE_KEYS.has(key), `non-allowlisted log key ${key}`).toBe(true);
    }
  }
}

const sendRequest = {
  method: "POST" as const,
  url: `/api/conversations/${C}/messages`,
  headers: { "content-type": "application/json", authorization: `Bearer ${CONTENT}` },
  payload: { clientMessageId: "k-1", content: CONTENT },
};

describe("AC-021 content absence in logs", () => {
  it("a successful send logs ids, a length and the response line — never the content", async () => {
    const app = buildServer(deps(() => accepted));
    const reply = await app.inject(sendRequest);
    expect(reply.statusCode).toBe(202);
    const lines = await settle(app);

    expect(lines.length).toBeGreaterThanOrEqual(2); // the capture works: a vacuous pass is impossible
    const acceptedLine = lines.find((line) => line.msg === "message accepted");
    expect(acceptedLine).toMatchObject({ conversationId: C, messageId: M, responseId: R, contentLength: CONTENT.length });
    expect(lines.find((line) => line.msg === "request completed")).toMatchObject({
      method: "POST",
      routePath: "/api/conversations/:conversationId/messages",
      statusCode: 202,
    });
    assertAllowlisted(lines);
    assertNoContent(lines);
  });

  it("a send whose use case throws an error carrying the content logs only the error code", async () => {
    const app = buildServer(
      deps(() => {
        throw new Error(`database said: ${CONTENT}\n    at send (/Users/dev/app.ts:1:1)`);
      }),
    );
    const reply = await app.inject(sendRequest);
    expect(reply.statusCode).toBe(500);
    expect(reply.body).not.toContain(CONTENT);
    const lines = await settle(app);
    expect(lines.find((line) => line.msg === "request failed")).toMatchObject({ errorCode: "INTERNAL_ERROR", statusCode: 500 });
    assertAllowlisted(lines);
    assertNoContent(lines);
  });

  it("a rejected send (validation) does not log the offending body", async () => {
    const app = buildServer(deps(() => accepted));
    const reply = await app.inject({ ...sendRequest, payload: { clientMessageId: "k-1", content: CONTENT, extra: CONTENT } });
    expect(reply.statusCode).toBe(400);
    const lines = await settle(app);
    expect(lines.find((line) => line.msg === "request rejected")).toMatchObject({ errorCode: "VALIDATION_FAILED", statusCode: 400 });
    assertAllowlisted(lines);
    assertNoContent(lines);
  });

  it("no line carries pid, hostname, url, headers, req/res objects or responseTime", async () => {
    const app = buildServer(deps(() => accepted));
    await app.inject(sendRequest);
    const lines = await settle(app);
    for (const line of lines) {
      for (const key of ["pid", "hostname", "url", "headers", "req", "res", "err", "responseTime", "reqId"]) {
        expect(line).not.toHaveProperty(key);
      }
    }
  });
});

describe("the allowlist formatter", () => {
  it("drops every non-allowlisted key even when a caller logs one directly", async () => {
    const app = buildServer(deps(() => accepted));
    await app.ready();
    app.log.info(
      { content: CONTENT, err: new Error(CONTENT), sql: "SELECT 1", env: { SECRET: CONTENT }, responseId: R },
      "direct log",
    );
    const lines = await settle(app);
    const direct = lines.find((line) => line.msg === "direct log");
    expect(direct).toBeDefined();
    expect(direct).toMatchObject({ responseId: R });
    assertAllowlisted(lines);
    assertNoContent(lines);
  });

  it("pickLogFields keeps only allowlisted scalar fields", () => {
    expect(
      pickLogFields({ requestId: "req-1", statusCode: 200, content: CONTENT, conversationId: { nested: true }, recoveredResponses: 2 }),
    ).toEqual({ requestId: "req-1", statusCode: 200, recoveredResponses: 2 });
  });

  it("the allowlist is exactly the §7.4 list", () => {
    expect([...LOG_FIELD_ALLOWLIST].sort()).toEqual([
      "contentLength", "conversationId", "durationMs", "errorCode", "eventSeq", "eventType", "messageId",
      "method", "recoveredResponses", "requestId", "responseId", "routePath", "statusCode",
    ]);
  });
});
