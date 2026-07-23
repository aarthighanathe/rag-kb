/**
 * @file query.schema.ts
 * @description Zod schemas for RAG query request validation, including optional
 *   conversation history for multi-turn memory.
 * @author [Author Placeholder]
 * @created 2026-06-16
 * @updated 2026-06-30
 */

import { z } from 'zod';
import { uuidParamSchema } from './common.schema.js';

/** Schema for a single conversation turn in the history array. */
export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000, 'Each history message must be at most 2000 characters'),
});

export type ConversationTurnInput = z.infer<typeof ConversationTurnSchema>;

/** Schema for the GET /api/query/stream query string. */
export const QueryStreamParamsSchema = uuidParamSchema('queryId');

export type QueryStreamParams = z.infer<typeof QueryStreamParamsSchema>;

/** Schema for the POST /api/query/:queryId/feedback path parameter. */
export const QueryFeedbackParamSchema = uuidParamSchema('queryId');

export type QueryFeedbackParam = z.infer<typeof QueryFeedbackParamSchema>;

/** Schema for the POST /api/query/:queryId/feedback request body. */
export const QueryFeedbackRequestSchema = z.object({
  feedback: z.enum(['helpful', 'not_helpful'], {
    errorMap: () => ({ message: "feedback must be 'helpful' or 'not_helpful'" }),
  }),
});

export type QueryFeedbackRequest = z.infer<typeof QueryFeedbackRequestSchema>;

/** Schema for the POST /api/query request body. */
export const QueryRequestSchema = z.object({
  query: z
    .string()
    .max(1000, 'Query must be at most 1000 characters')
    .transform((v) => v.trim())
    .pipe(z.string().min(3, 'Query must be at least 3 characters')),
  documentIds: z
    .array(z.string().uuid('Each documentId must be a valid UUID'))
    .max(10, 'Cannot filter by more than 10 documents')
    .optional()
    .describe('Optional: restrict search to specific document IDs'),
  matchCount: z
    .number()
    .int()
    .min(1, 'matchCount must be at least 1')
    .max(10, 'matchCount must be at most 10')
    .default(5)
    .describe('Number of similar chunks to retrieve for LLM context'),
  similarityThreshold: z
    .number()
    .min(0, 'similarityThreshold must be between 0 and 1')
    .max(1, 'similarityThreshold must be between 0 and 1')
    .default(0)
    .describe(
      'Minimum cosine similarity score for a chunk to be included. ' +
        'Scores are clamped to [0, 1] (cosine distance artefacts removed). ' +
        'Defaults to 0 — matchCount bounds result size. Raise (e.g. 0.15) ' +
        'if irrelevant chunks appear in answers.',
    ),
  history: z
    .array(ConversationTurnSchema)
    .max(6, 'History must not exceed 6 messages (3 exchanges)')
    .default([])
    .describe('Last N conversation turns for multi-turn context (oldest first)'),
});

export type QueryRequest = z.infer<typeof QueryRequestSchema>;
