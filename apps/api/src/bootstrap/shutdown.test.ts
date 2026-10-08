/**
 * SPECS §5.6, §7.4, §7.5 (FR-011, AC-005, AC-014).
 *
 * Two evidence layers, kept separate:
 * - Container level (deterministic: fakeClock + sequentialIds): shutdown() with
 *   a slow-but-not-hung provider run in flight. Only the drain bound uses the
 *   real clock.
 * - Real process (real-clock bounds): the built entrypoint (dist/index.js) runs
 *   as a child process on the pinned Node binary, against a test-owned database
 *   file. SIGINT with an idle loopback keep-alive connection open, restart on the
 *   same file with byte-identical snapshots of all four tables, and a non-zero
 *   recoveredResponses after a seeded interruption. Reconstructing a container
 *   alone does not establish process shutdown.
 *
 * Every owned resource registers its cleanup the moment it exists; teardown runs
 * the stack in reverse (children killed and awaited, agents destroyed, runs
 * aborted and settled, databases closed, timers cleared), and deletes the
 * test's own temporary database directories last — also when a test fails.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createConversationResponseSchema,
  getConversationResponseSchema,
  messageIdSchema,
  responseIdSchema,
  sendMessageAcceptedSchema,
} from "@rosetta-poc/chat-shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/env.js";
import { buildServer } from "../http/server.js";
import { closeDatabase } from "../persistence/db.js";
import type { ProviderChunk } from "../ports.js";
import { PROVIDER_FAILURE_MESSAGES } from "../provider/types.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";
import { createTempDb, type TempDb } from "../testing/temp-db.js";
import { createContainer, type Container, type ContainerOverrides } from "./container.js";
import { SHUTDOWN_TIMEOUT_MS, shutdown } from "./shutdown.js";

const T0 = "2026-09-28T10:00:00.000Z";
const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = join(API_DIR, "..", "..");
const NODE_BIN_DIR = dirname(process.execPath);
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;
const config = (dbPath: string): AppConfig => ({ dbPath, port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" });

// ---------------------------------------------------------------- owned-resource cleanup stack

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
});

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
beforeAll(() => {
  process.on("unhandledRejection", onUnhandled);
});
afterAll(() => {
  process.off("unhandledRejection", onUnhandled);
});

/** Registered first, so it runs last: after every child, handle and connection is gone. */
function tempDb(): TempDb {
  const temp = createTempDb();
  cleanups.push(() => temp.cleanup());
  return temp;
}

function ownedContainer(path: string, prefix: string, provider?: ContainerOverrides["provider"]): Container {
  const c = createContainer(config(path), { clock: fakeClock(T0), ids: sequentialIds(prefix), ...(provider === undefined ? {} : { provider }) });
  cleanups.push(async () => {
    for (const entry of c.registry) entry.controller.abort();
    while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
    closeDatabase(c.db);
  });
  return c;
}

/** Non-empty, ordered snapshot of all four tables, read through a separate read-only handle. */
function fileSnapshot(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = Object.fromEntries(
      TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))]),
    );
    for (const table of TABLES) {
      expect((tables[table] ?? []).length, `${table} is non-empty`).toBeGreaterThan(0);
    }
    return JSON.stringify(tables);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------- container level

describe("container level: bounded drain (§7.5)", () => {
  it("shutdown() with a slow-but-not-hung provider run in flight aborts it, awaits its settle within SHUTDOWN_TIMEOUT_MS, then closes the DB with no ERR_SQLITE_*/unhandled rejection, and the aborted response ends up failed", async () => {
    const temp = tempDb();
    let signal!: () => void;
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    let slowTimer: NodeJS.Timeout | undefined;
    let finishSlow!: () => void;
    cleanups.push(() => {
      clearTimeout(slowTimer);
      finishSlow?.(); // let the provider's iterator finish if it is still suspended
    });
    // Slow but not hung: after one delta it waits far longer than the drain bound, but would finish.
    const slowProvider = {
      async *stream(): AsyncGenerator<ProviderChunk> {
        yield { kind: "delta", text: "Mock " };
        signal();
        await new Promise<void>((resolve) => {
          finishSlow = resolve;
          slowTimer = setTimeout(resolve, 60_000);
        });
        yield { kind: "end" };
      },
    };
    const c = ownedContainer(temp.path, "a", slowProvider);
    const app = buildServer(c.serverDeps);
    cleanups.push(() => app.close());
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "slow one" });
    await reached;
    expect(c.registry.size).toBe(1); // fixture: one run genuinely in flight

    const startedAt = performance.now();
    await shutdown(c, app);
    const elapsed = performance.now() - startedAt; // real-clock bound, not a deterministic assertion

    expect(elapsed).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(c.registry.size).toBe(0);
    expect(c.isDraining()).toBe(true);
    expect(c.db.isOpen).toBe(false);
    expect(unhandled).toEqual([]);

    const reopened = ownedContainer(temp.path, "b");
    expect(reopened.responses.findById(accepted.response.id)).toMatchObject({
      status: "failed",
      partialText: "Mock ",
      failure: { code: "PROVIDER_INTERRUPTED", message: PROVIDER_FAILURE_MESSAGES.PROVIDER_INTERRUPTED },
    });
    expect(reopened.events.listAfter(accepted.response.id, 0).map((e) => e.type)).toEqual([
      "response.started",
      "response.delta",
      "response.failed",
    ]);
    expect(reopened.recover()).toBe(0); // nothing left active for boot recovery
  });
});

// ---------------------------------------------------------------- real process

interface Child {
  readonly process: ChildProcessWithoutNullStreams;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly base: string;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

const exited = (child: ChildProcessWithoutNullStreams): boolean => child.exitCode !== null || child.signalCode !== null;

async function startApi(dbPath: string): Promise<Child> {
  const port = await freePort();
  // Explicit environment: the pinned Node binary directory on PATH and only the five §7.1 variables.
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: API_DIR,
    env: {
      PATH: `${NODE_BIN_DIR}:/usr/bin:/bin`,
      CHAT_DB_PATH: dbPath,
      CHAT_API_PORT: String(port),
      CHAT_API_HOST: "127.0.0.1",
      CHAT_WEB_ORIGIN: "http://localhost:5173",
      CHAT_LOG_LEVEL: "info",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  // Registered immediately: only this spawned child, killed only if still alive, and its exit awaited
  // before the temp database directory is removed.
  cleanups.push(async () => {
    if (!exited(child)) child.kill("SIGKILL");
    await exit;
  });
  const result: Child = { process: child, stdout: [], stderr: [], base: `http://127.0.0.1:${port}` };
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => result.stdout.push(chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => result.stderr.push(chunk));
  // Readiness: an explicit successful /health, bounded.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited(child)) throw new Error(`API exited early: ${result.stderr.join("")}`);
    try {
      const reply = await fetch(`${result.base}/health`);
      if (reply.status === 200) return result;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("API did not become healthy");
}

/** Sends SIGINT to exactly this child and waits for its exit; returns the exit and elapsed real time. */
async function stopApi(child: Child): Promise<{ code: number | null; signal: NodeJS.Signals | null; elapsedMs: number }> {
  const startedAt = performance.now();
  const exit = once(child.process, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  child.process.kill("SIGINT");
  const [code, signal] = await exit;
  return { code, signal, elapsedMs: performance.now() - startedAt };
}

function logLines(child: Child): Record<string, unknown>[] {
  return child.stdout.join("").split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForTerminal(base: string, conversationId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const detail = getConversationResponseSchema.parse(await (await fetch(`${base}/api/conversations/${conversationId}`)).json());
    if (detail.responses.length > 0 && detail.activeResponse === null) return; // explicit terminal status
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("response did not reach a terminal status");
}

/**
 * Opens one idle keep-alive connection. The close observer is returned INSIDE an object: resolving
 * a promise with a promise would assimilate it, making the caller wait for the close before SIGINT.
 */
async function openIdleKeepAlive(base: string): Promise<{ readonly closed: Promise<void>; readonly idleBeforeSignal: boolean }> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  cleanups.push(() => agent.destroy());
  return new Promise((resolve, reject) => {
    const request = http.get(`${base}/health`, { agent }, (res) => {
      const socket = res.socket;
      cleanups.push(() => socket.destroy());
      const closed = new Promise<void>((done) => socket.once("close", () => done()));
      res.resume();
      res.on("end", () => resolve({ closed, idleBeforeSignal: !socket.destroyed }));
    });
    request.on("error", reject);
  });
}

describe("real process: entrypoint stop and restart on the same file", () => {
  beforeAll(() => {
    // The process tests run the BUILT entrypoint; build the API project with the repository's own
    // tsc on the same pinned Node binary (npm test's pretest builds only the shared package).
    const build = spawnSync(process.execPath, [join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-b", join(API_DIR, "tsconfig.json")], {
      cwd: REPO_ROOT,
      env: { PATH: `${NODE_BIN_DIR}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    expect(build.status, build.stdout + build.stderr).toBe(0);
  }, 120_000);

  it("runs on the pinned Node binary", () => {
    expect(process.version).toBe("v24.21.0");
  });

  it("shutdown() while an idle HTTP keep-alive connection is open closes that connection and exits inside the bound with code 0", async () => {
    const temp = tempDb();
    const api = await startApi(temp.path);
    const keepAlive = await openIdleKeepAlive(api.base);
    expect(keepAlive.idleBeforeSignal).toBe(true); // fixture: the connection is open and idle before SIGINT

    const exit = await stopApi(api);
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(exit.elapsedMs).toBeLessThan(SHUTDOWN_TIMEOUT_MS); // real-clock bound
    await keepAlive.closed; // the server closed the idle keep-alive socket
    expect(api.stderr.join("")).toBe("");
    expect(api.stdout.join("")).not.toMatch(/ERR_SQLITE|listening|127\.0\.0\.1/u);
  }, 60_000);

  it("a stopped process restarted on the same file preserves all four tables byte-for-byte (AC-005) and reports recoveredResponses for an interrupted response (AC-014)", async () => {
    const temp = tempDb();

    // Run 1: create and complete a conversation through the real process.
    const first = await startApi(temp.path);
    expect(logLines(first).find((line) => line.msg === "recovery complete")).toMatchObject({ recoveredResponses: 0 });
    const created = createConversationResponseSchema.parse(await (await fetch(`${first.base}/api/conversations`, { method: "POST" })).json());
    const conversationId = created.conversation.id;
    const sent = await fetch(`${first.base}/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientMessageId: "k-1", content: "survive a restart" }),
    });
    expect(sent.status).toBe(202);
    sendMessageAcceptedSchema.parse(await sent.json());
    await waitForTerminal(first.base, conversationId);
    const before = fileSnapshot(temp.path); // all four tables non-empty, before the stop
    const detailBefore = await (await fetch(`${first.base}/api/conversations/${conversationId}`)).json();
    expect(getConversationResponseSchema.parse(detailBefore).responses[0]?.status).toBe("completed");
    expect(await stopApi(first)).toMatchObject({ code: 0, signal: null });

    // Run 2: the real entrypoint on the same file ⇒ byte-identical tables, nothing to recover.
    const second = await startApi(temp.path);
    expect(logLines(second).find((line) => line.msg === "recovery complete")).toMatchObject({ recoveredResponses: 0 });
    expect(fileSnapshot(temp.path)).toBe(before);
    expect(await (await fetch(`${second.base}/api/conversations/${conversationId}`)).json()).toEqual(detailBefore);
    expect(await stopApi(second)).toMatchObject({ code: 0, signal: null });

    // Simulated crash while the process is down: a response left pending with no events.
    const seeding = createContainer(config(temp.path), { clock: fakeClock(T0), ids: sequentialIds("e") });
    cleanups.push(() => closeDatabase(seeding.db));
    const seedIds = sequentialIds("f");
    const userMessageId = messageIdSchema.parse(seedIds.next());
    const responseId = responseIdSchema.parse(seedIds.next());
    seeding.uow.run(() => {
      seeding.messages.insert({ id: userMessageId, conversationId, role: "user", content: "interrupted", clientMessageId: "k-2", createdAt: T0 });
      seeding.responses.insert({ id: responseId, conversationId, userMessageId, retryOfResponseId: null, createdAt: T0, updatedAt: T0 });
    });
    expect(seeding.responses.listActive().map((r) => r.id)).toEqual([responseId]); // fixture check
    closeDatabase(seeding.db);

    // Run 3: recovery before listen reports the interrupted response and fails it.
    const third = await startApi(temp.path);
    expect(logLines(third).find((line) => line.msg === "recovery complete")).toMatchObject({ recoveredResponses: 1 });
    const recovered = getConversationResponseSchema.parse(await (await fetch(`${third.base}/api/conversations/${conversationId}`)).json());
    expect(recovered.activeResponse).toBeNull();
    expect(recovered.responses.find((r) => r.id === responseId)).toMatchObject({
      status: "failed",
      failure: { code: "PROVIDER_INTERRUPTED", message: PROVIDER_FAILURE_MESSAGES.PROVIDER_INTERRUPTED },
    });
    expect(await stopApi(third)).toMatchObject({ code: 0, signal: null });
    for (const run of [first, second, third]) {
      expect(run.stderr.join("")).toBe("");
      expect(run.stdout.join("")).not.toMatch(/ERR_SQLITE/u);
    }
  }, 120_000);
});
