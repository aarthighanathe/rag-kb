/**
 * @file queue.schema.ts
 * @description Zod schemas for admin queue monitoring routes
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { z } from 'zod';
import { uuidParamSchema } from './common.schema.js';

/** Schema for GET /api/queue/job/:jobId path parameter. jobId equals the documentId (a UUID). */
export const JobIdParamSchema = uuidParamSchema('jobId');

export type JobIdParam = z.infer<typeof JobIdParamSchema>;
