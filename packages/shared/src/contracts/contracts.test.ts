/**
 * SPECS §4.1, §4.2, §4.3, §4.6, §6.2 (FR-002, FR-010, AC-004, AC-019, AC-021).
 * Every object schema is strict, so an unknown field fails on both sides
 * (AC-004). Imported through the package barrel, as api and web consume it.
 */
import { describe, expect, it } from "vitest";
import {
  VALIDATION_ISSUE_MESSAGES,
  clientMessageIdSchema,
  conversationIdSchema,
  conversationSchema,
  conversationSummarySchema,
  createConversationRequestSchema,
  createConversationResponseSchema,
  errorCodeSchema,
  errorEnvelopeSchema,
  eventIdSchema,
  getConversationResponseSchema,
  healthResponseSchema,
  isoTimestampSchema,
  listConversationsResponseSchema,
  messageSchema,
  responseSchema,
  retryAcceptedSchema,
  sendMessageAcceptedSchema,
  sendMessageRequestSchema,
  seqSchema,
  streamEventSchema,
} from "../index.js";

const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const T = "2026-09-27T10:00:00.000Z";

const conversation = { id: C, title: "New conversation", createdAt: T, updatedAt: T };
const message = { id: M, conversationId: C, seq: 1, role: "user", content: "hi", clientMessageId: "k", createdAt: T };
const response = {
  id: R, conversationId: C, userMessageId: M, assistantMessageId: null, status: "pending", partialText: "",
  failure: null, retryOfResponseId: null, retriedByResponseId: null, createdAt: T, updatedAt: T,
};

describe("§4.1 identifiers and primitives", () => {
  it("entity ids are UUIDs", () => {
    expect(conversationIdSchema.safeParse(C).success).toBe(true);
    expect(conversationIdSchema.safeParse("c-1").success).toBe(false);
  });

  it("clientMessageId: length 1 and 128 accepted, 0 and 129 rejected, not required to be a UUID", () => {
    expect(clientMessageIdSchema.safeParse("k").success).toBe(true);
    expect(clientMessageIdSchema.safeParse("k".repeat(128)).success).toBe(true);
    expect(clientMessageIdSchema.safeParse("").success).toBe(false);
    expect(clientMessageIdSchema.safeParse("k".repeat(129)).success).toBe(false);
  });

  it("timestamps are UTC ISO-8601 with no offset", () => {
    expect(isoTimestampSchema.safeParse(T).success).toBe(true);
    expect(isoTimestampSchema.safeParse("2026-09-27T12:00:00.000+02:00").success).toBe(false);
    expect(isoTimestampSchema.safeParse("yesterday").success).toBe(false);
  });

  it("seq is a positive integer; an event id may be 0", () => {
    expect(seqSchema.safeParse(1).success).toBe(true);
    for (const bad of [0, -1, 1.5]) expect(seqSchema.safeParse(bad).success).toBe(false);
    expect(eventIdSchema.safeParse(0).success).toBe(true);
    expect(eventIdSchema.safeParse(-1).success).toBe(false);
  });
});

describe("§4.2/§4.3 entity and body schemas are strict (AC-004)", () => {
  it.each([
    ["conversation", conversationSchema, conversation],
    ["conversation summary", conversationSummarySchema, { id: C, title: "t", updatedAt: T }],
    ["message", messageSchema, message],
    ["response", responseSchema, response],
    ["create response", createConversationResponseSchema, { conversation }],
    ["list response", listConversationsResponseSchema, { conversations: [{ id: C, title: "t", updatedAt: T }] }],
    ["get response", getConversationResponseSchema, { conversation, messages: [message], responses: [response], activeResponse: response }],
    ["send accepted", sendMessageAcceptedSchema, { conversationId: C, userMessage: message, response }],
    ["retry accepted", retryAcceptedSchema, { conversationId: C, responseId: R, retryOfResponseId: R }],
    ["health", healthResponseSchema, { status: "ok", database: "ok" }],
  ] as const)("%s: valid parses, an unknown field is rejected", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(false);
  });

  it("create request is exactly {}", () => {
    expect(createConversationRequestSchema.safeParse({}).success).toBe(true);
    expect(createConversationRequestSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  it("send request: missing clientMessageId or extra field rejected; content itself is any string here", () => {
    expect(sendMessageRequestSchema.safeParse({ clientMessageId: "k", content: "   " }).success).toBe(true);
    expect(sendMessageRequestSchema.safeParse({ content: "hi" }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({ clientMessageId: "k", content: "hi", role: "system" }).success).toBe(false);
  });

  it("response status and role enums are closed", () => {
    expect(responseSchema.safeParse({ ...response, status: "cancelled" }).success).toBe(false);
    expect(messageSchema.safeParse({ ...message, role: "system" }).success).toBe(false);
  });
});

describe("§6.2 stream event union", () => {
  const started = { type: "response.started", data: { responseId: R, conversationId: C, seq: 1 } };
  const delta = { type: "response.delta", data: { responseId: R, seq: 2, text: "Mock " } };
  const completed = { type: "response.completed", data: { responseId: R, seq: 3, assistantMessage: { ...message, role: "assistant", clientMessageId: null } } };
  const failed = { type: "response.failed", data: { responseId: R, seq: 3, failure: { code: "PROVIDER_ERROR", message: "x" } } };

  it("accepts each of the four event types", () => {
    for (const event of [started, delta, completed, failed]) expect(streamEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects an unknown type, a payload of another type, seq 0, and extra fields", () => {
    expect(streamEventSchema.safeParse({ type: "response.cancelled", data: delta.data }).success).toBe(false);
    expect(streamEventSchema.safeParse({ type: "response.delta", data: started.data }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...delta, data: { ...delta.data, seq: 0 } }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...delta, data: { ...delta.data, extra: 1 } }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...delta, id: 2 }).success).toBe(false);
  });

  it("failure codes are the four provider codes only", () => {
    expect(streamEventSchema.safeParse({ ...failed, data: { ...failed.data, failure: { code: "BOOM", message: "x" } } }).success).toBe(false);
  });
});

describe("§4.6 error envelope", () => {
  it("has exactly the 11 stable codes", () => {
    expect([...errorCodeSchema.options].sort()).toEqual([
      "DATABASE_UNAVAILABLE", "IDEMPOTENCY_KEY_CONFLICT", "INTERNAL_ERROR", "INVALID_LAST_EVENT_ID",
      "LAST_EVENT_ID_OUT_OF_RANGE", "NOT_FOUND", "RESPONSE_ALREADY_ACTIVE", "RESPONSE_NOT_FAILED",
      "RETRY_NOT_ALLOWED", "SERVICE_UNAVAILABLE", "VALIDATION_FAILED",
    ]);
  });

  it("details are optional; the envelope and its inner object are strict", () => {
    const base = { error: { code: "NOT_FOUND", message: "m", requestId: "r" } };
    expect(errorEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { ...base.error, details: [{ path: "content", message: "m" }] } }).success).toBe(true);
    expect(errorEnvelopeSchema.safeParse({ error: { ...base.error, stack: "at x" } }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ error: { ...base.error, code: "TEAPOT" } }).success).toBe(false);
  });

  it("the fixed issue-code message map covers every Zod 4 issue code with a constant, non-empty message", () => {
    expect(Object.keys(VALIDATION_ISSUE_MESSAGES).sort()).toEqual([
      "custom", "invalid_element", "invalid_format", "invalid_key", "invalid_type", "invalid_union",
      "invalid_value", "not_multiple_of", "too_big", "too_small", "unrecognized_keys",
    ]);
    for (const text of Object.values(VALIDATION_ISSUE_MESSAGES)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[{}$%]/); // no template placeholders
    }
  });
});
