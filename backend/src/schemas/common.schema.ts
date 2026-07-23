/**
 * @file common.schema.ts
 * @description Shared Zod schema factories used across multiple route param schemas.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { z } from 'zod';

/**
 * Builds a single-field path-param schema validating `field` as a UUID.
 * Extracted from four copy-paste-identical schemas (DocumentIdParamSchema,
 * QueryStreamParamsSchema, QueryFeedbackParamSchema, JobIdParamSchema) that
 * differed only in the field name.
 * @param field - Name of the path parameter (e.g. 'id', 'jobId', 'queryId')
 * @returns Zod object schema with one UUID-validated field
 */
export function uuidParamSchema<TField extends string>(field: TField) {
  return z.object({
    [field]: z.string().uuid(`${field} must be a valid UUID`),
  }) as z.ZodObject<{ [K in TField]: z.ZodString }>;
}
