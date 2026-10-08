/**
 * SPECS §3.4, §3.4a, §4.5 (FR-008, AC-017, A-003). Container-level with
 * fakeClock + sequentialIds. A fail-first provider makes the original run fail
 * and every later run succeed.
 */
import type { ResponseId } from "@rosetta-poc/chat-shared";
import { afterEach, describe, expect, it } from "vitest";
import { createContainer, type Container } from "../bootstrap/container.js";
import type { AppConfig } from "../config/env.js";
import { NotFoundError, ResponseAlreadyActiveError, ResponseNotFailedError, RetryNotAllowedError } from "../domain/errors.js";
import { closeDatabase } from "../persistence/db.js";
import type { Provider } from "../ports.js";
import { createDeterministicProvider } from "../provider/deterministic-provider.js";
import { failingProvider } from "../testing/provider-doubles.js";
import { fakeClock } from "../testing/fake-clock.js";
import { sequentialIds } from "../testing/sequential-ids.js";

const T0 = "2026-09-28T10:00:00.000Z";
const config: AppConfig = { dbPath: ":memory:", port: 1, host: "127.0.0.1", webOrigin: "http://localhost:5173", logLevel: "fatal" };
const TABLES = ["conversations", "messages", "responses", "stream_events"] as const;

/** The first run fails (PROVIDER_ERROR); later runs use the deterministic provider. */
function failFirst(): Provider & { readonly runs: number } {
  let runs = 0;
  const fail = failingProvider("PROVIDER_ERROR");
  const ok = createDeterministicProvider();
  return {
    get runs() {
      return runs;
    },
    stream(input) {
      runs += 1;
      return (runs === 1 ? fail : ok).stream(input);
    },
  };
}

const owned: Container[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  // On failure too: open every gate and abort every in-flight run, so settlement can never hang.
  for (const release of releases.splice(0)) release();
  for (const c of owned.splice(0)) {
    for (const entry of c.registry) entry.controller.abort();
    await settle(c);
    closeDatabase(c.db);
  }
});

async function settle(c: Container): Promise<void> {
  while (c.registry.size > 0) await Promise.allSettled([...c.registry].map((entry) => entry.promise));
}

function snapshot(c: Container): Record<string, unknown[]> {
  return Object.fromEntries(TABLES.map((t) => [t, c.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
}

async function failedSend(provider: Provider) {
  const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a"), provider });
  owned.push(c);
  const conversationId = c.serverDeps.createConversation().conversation.id;
  const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "please retry me" });
  await settle(c);
  expect(c.responses.findById(accepted.response.id)?.status).toBe("failed"); // fixture check
  return { c, conversationId, original: accepted.response.id };
}

describe("AC-017", () => {
  it("second retry returns the same replacement, one user message", async () => {
    const provider = failFirst();
    const { c, conversationId, original } = await failedSend(provider);

    const first = c.serverDeps.retryResponse(original);
    expect(first).toMatchObject({ conversationId, retryOfResponseId: original });
    expect(first.responseId).not.toBe(original);
    await settle(c);
    expect(c.responses.findById(first.responseId)?.status).toBe("completed");

    const before = snapshot(c);
    const second = c.serverDeps.retryResponse(original);
    expect(second).toEqual(first);
    expect(snapshot(c)).toEqual(before); // zero writes
    expect(c.registry.size).toBe(0); // no second run

    const detail = c.serverDeps.getConversation(conversationId);
    expect(detail.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(detail.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["Mock reply: please retry me"]);
    expect(detail.responses.map((r) => [r.id, r.status, r.retryOfResponseId, r.retriedByResponseId])).toEqual([
      [original, "failed", null, first.responseId],
      [first.responseId, "completed", original, null],
    ]);
    expect(provider.runs).toBe(2);
  });
});

describe("retry rejections write nothing", () => {
  it("retry of a completed response ⇒ RESPONSE_NOT_FAILED", async () => {
    const c = createContainer(config, { clock: fakeClock(T0), ids: sequentialIds("a") });
    owned.push(c);
    const conversationId = c.serverDeps.createConversation().conversation.id;
    const accepted = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-1", content: "fine" });
    await settle(c);
    const before = snapshot(c);
    expect(() => c.serverDeps.retryResponse(accepted.response.id)).toThrow(ResponseNotFailedError);
    expect(snapshot(c)).toEqual(before);
  });

  it("retry of a (failed) replacement ⇒ RETRY_NOT_ALLOWED (A-003)", async () => {
    const { c, original } = await failedSend(failingProvider("PROVIDER_ERROR")); // every run fails
    const replacement = c.serverDeps.retryResponse(original).responseId;
    await settle(c);
    expect(c.responses.findById(replacement)?.status).toBe("failed");
    const before = snapshot(c);
    expect(() => c.serverDeps.retryResponse(replacement)).toThrow(RetryNotAllowedError);
    expect(snapshot(c)).toEqual(before);
  });

  it("retry of an unknown response ⇒ NOT_FOUND", async () => {
    const { c } = await failedSend(failFirst());
    const before = snapshot(c);
    expect(() => c.serverDeps.retryResponse("00000000-0000-4000-8000-00000000ffff" as ResponseId)).toThrow(NotFoundError);
    expect(snapshot(c)).toEqual(before);
  });

  it("a new replacement while another response in the conversation is active ⇒ RESPONSE_ALREADY_ACTIVE, zero writes", async () => {
    // Run 1 fails; run 2 yields one delta, signals, then waits for an explicit release (genuinely active).
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { signal = resolve; });
    releases.push(() => release());
    let runs = 0;
    const scripted: Provider = {
      stream(input) {
        runs += 1;
        if (runs === 1) return failingProvider("PROVIDER_ERROR").stream(input);
        return (async function* () {
          yield { kind: "delta" as const, text: "Mock " };
          signal();
          await gate;
          yield { kind: "end" as const };
        })();
      },
    };
    const { c, conversationId, original } = await failedSend(scripted);
    const other = c.serverDeps.sendMessage({ conversationId, clientMessageId: "k-2", content: "now active" });
    await reached;
    expect(c.responses.findActiveByConversation(conversationId)?.id).toBe(other.response.id); // fixture check
    const before = snapshot(c);
    expect(() => c.serverDeps.retryResponse(original)).toThrow(ResponseAlreadyActiveError);
    expect(snapshot(c)).toEqual(before);
    release();
    await settle(c);
    expect(c.responses.findById(other.response.id)?.status).toBe("completed");
  });
});
