/**
 * @file correlationId.ts
 * @description Attaches a UUID v4 correlation ID to every incoming request for log tracing
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { type Request, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

/**
 * Express middleware that generates or propagates a correlation ID for each request.
 * If the client sends X-Correlation-ID header, that value is used.
 * Otherwise a new UUID v4 is generated.
 * The ID is attached to req.correlationId and echoed back in the response header.
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers[CORRELATION_ID_HEADER.toLowerCase()];
  const correlationId = typeof existing === 'string' && existing.length <= 128
    ? existing.slice(0, 128)
    : uuidv4();

  req.correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  next();
}
