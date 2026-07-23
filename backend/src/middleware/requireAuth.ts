/**
 * @file requireAuth.ts
 * @description Clerk JWT verification middleware. Verifies the Bearer token on every
 *   protected route and attaches the authenticated userId (Clerk's `sub` claim) to
 *   req.auth so downstream services can filter every query by owner.
 * @author [Author Placeholder]
 * @created 2026-07-05
 */

import { verifyToken } from '@clerk/backend';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Express middleware that verifies a Clerk JWT from the Authorization header.
 * Attaches `{ userId, email }` to `req.auth` on success.
 * Responds 401 if the header is missing, malformed, or the token fails verification.
 * @param req - Incoming request; must carry `Authorization: Bearer <token>`
 * @param res - Used to send a 401 envelope on failure
 * @param next - Passes control to the next handler once req.auth is set
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Sign in to continue.',
      },
      correlationId: req.correlationId,
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    const email = payload['email'];

    req.auth = {
      userId: payload.sub,
      ...(typeof email === 'string' ? { email } : {}),
    };

    logger.info('Request authenticated', {
      userId: payload.sub,
      correlationId: req.correlationId,
    });

    next();
  } catch (err) {
    logger.warn('JWT verification failed', {
      error: err instanceof Error ? err.message : String(err),
      correlationId: req.correlationId,
    });

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Your session has expired. Please sign in again.',
      },
      correlationId: req.correlationId,
    });
  }
}
