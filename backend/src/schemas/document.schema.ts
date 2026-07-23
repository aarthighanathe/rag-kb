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
