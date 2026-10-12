/**
 * HTTP client — apps/web/src/api/http-client.ts. SPECS §4.3, §4.6, §9.2
 * (FR-002, FR-010, AC-004, AC-018). fetch + shared Zod parse + error-envelope
 * decode. Every 2xx body is parsed with the same shared schema the server
 * produces it from, so an unknown field fails here too (AC-004).
 *
 * Calls resolve to a result, never reject: failures arrive as a classified
 * UiError with exactly one next action (§9.2).
 */
import {
  createConversationResponseSchema,
  errorEnvelopeSchema,
  getConversationResponseSchema,
  listConversationsResponseSchema,
  retryAcceptedSchema,
  sendMessageAcceptedSchema,
  type ConversationId,
  type CreateConversationResponse,
  type ErrorCode,
  type GetConversationResponse,
  type ListConversationsResponse,
  type ResponseFailure,
  type ResponseId,
  type RetryAccepted,
  type SendMessageAccepted,
  type SendMessageRequest,
} from "@rosetta-poc/chat-shared";
import type { z } from "zod";
import type { UiError, UiErrorKind } from "../state/ui-status";

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: UiError };

/** The send flow's network failure offers "retry-send" instead of "reload" (§9.2). */
export type RequestFlow = "send" | "other";

const NETWORK_MESSAGE = "The server could not be reached.";
const UNPARSEABLE_MESSAGE = "The server sent an unexpected response.";

/** §9.2 fixed mapping: these codes are validation (fix-input); every other code is server (reload). */
const VALIDATION_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "VALIDATION_FAILED",
  "INVALID_LAST_EVENT_ID",
  "LAST_EVENT_ID_OUT_OF_RANGE",
  "IDEMPOTENCY_KEY_CONFLICT",
]);

export function networkError(flow: RequestFlow): UiError {
  return {
    kind: "network",
    code: "NETWORK_ERROR",
    message: NETWORK_MESSAGE,
    nextAction: flow === "send" ? "retry-send" : "reload",
  };
}

/** A body that is neither the expected schema nor a valid error envelope (§9.2: server). */
export function unparseableError(): UiError {
  return { kind: "server", code: "INVALID_RESPONSE", message: UNPARSEABLE_MESSAGE, nextAction: "reload" };
}

export function envelopeError(code: ErrorCode, message: string): UiError {
  const kind: UiErrorKind = VALIDATION_CODES.has(code) ? "validation" : "server";
  return { kind, code, message, nextAction: kind === "validation" ? "fix-input" : "reload" };
}

/** A response.failed SSE event (§9.2: provider, retry-response). */
export function providerError(failure: ResponseFailure): UiError {
  return { kind: "provider", code: failure.code, message: failure.message, nextAction: "retry-response" };
}

/** Decodes a non-2xx body: a valid envelope maps by code; anything else is unparseable. */
export async function errorFromResponse(response: globalThis.Response): Promise<UiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unparseableError();
  }
  const envelope = errorEnvelopeSchema.safeParse(body);
  return envelope.success
    ? envelopeError(envelope.data.error.code, envelope.data.error.message)
    : unparseableError();
}

async function request<S extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: S,
  flow: RequestFlow,
): Promise<ApiResult<z.output<S>>> {
  let response: globalThis.Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: networkError(flow) };
  }
  if (!response.ok) {
    return { ok: false, error: await errorFromResponse(response) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: unparseableError() };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: unparseableError() };
}

export interface HttpClient {
  createConversation(signal?: AbortSignal): Promise<ApiResult<CreateConversationResponse>>;
  listConversations(signal?: AbortSignal): Promise<ApiResult<ListConversationsResponse>>;
  getConversation(
    conversationId: ConversationId,
    signal?: AbortSignal,
  ): Promise<ApiResult<GetConversationResponse>>;
  sendMessage(
    conversationId: ConversationId,
    body: SendMessageRequest,
    signal?: AbortSignal,
  ): Promise<ApiResult<SendMessageAccepted>>;
  retryResponse(responseId: ResponseId, signal?: AbortSignal): Promise<ApiResult<RetryAccepted>>;
}

/** baseUrl has no trailing slash (config/env.ts). */
export function createHttpClient(baseUrl: string): HttpClient {
  const url = (path: string): string => `${baseUrl}${path}`;
  const withSignal = (init: RequestInit, signal: AbortSignal | undefined): RequestInit =>
    signal === undefined ? init : { ...init, signal };

  return {
    // No body: the server treats an absent body as {} (SPECS §4.3).
    createConversation: (signal) =>
      request(url("/api/conversations"), withSignal({ method: "POST" }, signal), createConversationResponseSchema, "other"),
    listConversations: (signal) =>
      request(url("/api/conversations"), withSignal({ method: "GET" }, signal), listConversationsResponseSchema, "other"),
    getConversation: (conversationId, signal) =>
      request(
        url(`/api/conversations/${encodeURIComponent(conversationId)}`),
        withSignal({ method: "GET" }, signal),
        getConversationResponseSchema,
        "other",
      ),
    sendMessage: (conversationId, body, signal) =>
      request(
        url(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),
        withSignal(
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
          signal,
        ),
        sendMessageAcceptedSchema,
        "send",
      ),
    retryResponse: (responseId, signal) =>
      request(
        url(`/api/responses/${encodeURIComponent(responseId)}/retry`),
        withSignal({ method: "POST" }, signal),
        retryAcceptedSchema,
        "other",
      ),
  };
}
