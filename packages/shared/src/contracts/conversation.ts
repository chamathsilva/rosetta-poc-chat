/**
 * Conversation entity contracts — packages/shared/src/contracts/conversation.ts.
 * SPECS §4.2 entity contracts table, §4.3 endpoint contracts (create/list/get
 * bodies — SPECS §2.1: "conversation.ts ... create/list bodies").
 *
 * §4.3's table gives explicit names to 5 request/response bodies but leaves
 * 3 response shapes inline/unnamed (create response `{ conversation }`, list
 * response `{ conversations }`, get-detail response
 * `{ conversation, messages, responses, activeResponse }`). AC-004 requires a
 * single shared definition parsed by both api and web for every body, so
 * these three get names here too — the shape is exactly SPECS §4.3's, only
 * the export name is an implementation choice (flagged for review).
 */
import { z } from "zod";
import { conversationIdSchema, isoTimestampSchema } from "../ids.js";
import { messageSchema } from "./message.js";
import { responseSchema } from "./response.js";

export const conversationSchema = z
  .object({
    id: conversationIdSchema,
    title: z.string(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationSummarySchema = z
  .object({
    id: conversationIdSchema,
    title: z.string(),
    updatedAt: isoTimestampSchema,
  })
  .strict();
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** POST /api/conversations request body — SPECS §4.3; absent body treated as {}. */
export const createConversationRequestSchema = z.object({}).strict();
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

/** POST /api/conversations response body — SPECS §4.3: `{ conversation }`. */
export const createConversationResponseSchema = z
  .object({ conversation: conversationSchema })
  .strict();
export type CreateConversationResponse = z.infer<typeof createConversationResponseSchema>;

/** GET /api/conversations response body — SPECS §4.3: `{ conversations: ConversationSummary[] }`. */
export const listConversationsResponseSchema = z
  .object({ conversations: z.array(conversationSummarySchema) })
  .strict();
export type ListConversationsResponse = z.infer<typeof listConversationsResponseSchema>;

/**
 * GET /api/conversations/:conversationId response body — SPECS §4.3:
 * `{ conversation, messages, responses, activeResponse: Response | null }`.
 * `activeResponse` is exactly the element of `responses` whose status is
 * active (SPECS §3.2 `isActiveStatus`), or null — enforced by the producer,
 * not re-derived by this schema.
 */
export const getConversationResponseSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(messageSchema),
    responses: z.array(responseSchema),
    activeResponse: responseSchema.nullable(),
  })
  .strict();
export type GetConversationResponse = z.infer<typeof getConversationResponseSchema>;
