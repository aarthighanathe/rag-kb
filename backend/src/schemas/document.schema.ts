/**
 * @file document.schema.ts
 * @description Zod schemas for document listing and document management API shapes
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { z } from 'zod';
import { uuidParamSchema } from './common.schema.js';

/** Schema for GET /api/documents query parameters. */
export const ListDocumentsQuerySchema = z.object({
  // z.coerce.number() accepts both string and number inputs from query strings
  page: z.coerce.number().int().positive('page must be positive').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be 1–100')
    .max(100, 'limit must be 1–100')
    .default(20),
  status: z.enum(['pending', 'processing', 'ready', 'failed']).optional(),
});

export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

/** Schema for GET /api/documents/:id path parameter. */
export const DocumentIdParamSchema = uuidParamSchema('id');

export type DocumentIdParam = z.infer<typeof DocumentIdParamSchema>;

/** Schema for GET /api/documents/similarity query parameters. */
export const SimilarityQuerySchema = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.3),
});

export type SimilarityQuery = z.infer<typeof SimilarityQuerySchema>;

/**
 * Schema for GET /api/documents/suggested-topics query parameters.
 * documentIds arrives as a comma-separated string (query strings can't carry
 * arrays cleanly without repeated keys) and is split/validated as a UUID array.
 */
export const SuggestedTopicsQuerySchema = z.object({
  documentIds: z
    .string()
    .min(1, 'documentIds is required')
    .transform((v) =>
      v
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(z.string().uuid('Each documentId must be a valid UUID')).min(1).max(10)),
});

export type SuggestedTopicsQuery = z.infer<typeof SuggestedTopicsQuerySchema>;

/** Schema for PATCH /api/documents/:id/tags request body. */
export const UpdateDocumentTagsRequestSchema = z.object({
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'A tag cannot be empty')
        .max(40, 'A tag must be at most 40 characters'),
    )
    .max(20, 'Cannot set more than 20 tags')
    .describe(
      "Replaces the document's full tag list (both auto-derived and manually-added tags share this one field).",
    ),
});

export type UpdateDocumentTagsRequest = z.infer<typeof UpdateDocumentTagsRequestSchema>;
