/**
 * @file validate.ts
 * @description Zod validation middleware factory — passes ZodError to global error handler (→ 422)
 *
 * Threat: A03 Injection — unvalidated input can carry SQL fragments, path sequences,
 * or oversized payloads.  Zod parses and coerces before any service layer sees the data.
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { type ZodSchema } from 'zod';
import { logger } from '../utils/logger.js';

type RequestTarget = 'body' | 'params' | 'query';

/**
 * Creates an Express middleware that validates the specified part of a request against a Zod schema.
 * On success, the validated (and coerced/defaulted) data replaces the original target on the request.
 * On failure, calls next(ZodError) so the global error handler formats it as 422 with field details.
 * @param schema - Zod schema to validate against
 * @param target - Part of the request to validate: 'body', 'params', or 'query'
 * @returns Express middleware function
 */
export function validate<T>(schema: ZodSchema<T>, target: RequestTarget = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      logger.warn('Validation failed', {
        correlationId: req.correlationId,
        target,
        path: req.path,
        issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
      // Pass ZodError directly — global errorHandler maps it to 422 with field details
      next(result.error);
      return;
    }

    // Replace with Zod-transformed data so defaults and coercions are applied.
    // In Express 5, req.query is a getter-only property; use Object.defineProperty
    // to override it with a writable data descriptor without triggering the setter guard.
    if (target === 'query') {
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      // Double-cast through unknown: Express Request has no index signature, so
      // the direct cast to Record<string,unknown> fails strict checks.
      (req as unknown as Record<string, unknown>)[target] = result.data;
    }
    next();
  };
}

/**
 * Validates req.body against the given Zod schema.
 * Convenience wrapper around {@link validate} for the common body-validation case.
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return validate(schema, 'body');
}

/**
 * Validates req.query against the given Zod schema.
 * Use for GET/DELETE endpoints that carry parameters in the query string.
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return validate(schema, 'query');
}

/**
 * Validates req.params against the given Zod schema.
 * Use for route parameters like :id that must conform to a known shape.
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return validate(schema, 'params');
}
