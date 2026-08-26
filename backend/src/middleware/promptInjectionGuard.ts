/**
 * @file promptInjectionGuard.ts
 * @description Middleware for detecting and blocking prompt injection attempts
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { type Request, type Response, type NextFunction } from 'express';
import {
  logInjectionAttempt,
  checkPromptInjection,
  type InjectionCheckResult,
} from '../utils/promptInjectionFilter.js';
import { logger } from '../utils/logger.js';

/**
 * Shape of the request body fields this guard cares about. The body has not
 * necessarily been validated by a Zod schema yet at this point in the
 * middleware chain, so `query` is narrowed defensively at the call site.
 */
interface QueryBody {
  query?: unknown;
}

/**
 * Rejects the request with a 400 error for a high-risk injection attempt.
 * @param req - Incoming request, used only for the authenticated userId (if any)
 * @param res - Used to send the 400 envelope
 * @param result - The injection check result that led to rejection
 */
function rejectHighRiskInjection(req: Request, res: Response, result: InjectionCheckResult): void {
  logger.warn('Prompt injection blocked', {
    userId: req.auth?.userId,
    riskLevel: result.riskLevel,
    matchedPatterns: result.matchedPatterns,
  });

  res.status(400).json({
    success: false,
    error: {
      code: 'PROMPT_INJECTION_DETECTED',
      message:
        'Your query contains patterns that may be attempting to manipulate system instructions. Please rephrase your question.',
    },
  });
}

/**
 * Sanitizes a medium-risk injection in place on the request body and logs it.
 * @param req - Incoming request; `req.body.query` is overwritten with the sanitized text
 * @param result - The injection check result carrying the sanitized query
 */
function sanitizeMediumRiskInjection(req: Request, result: InjectionCheckResult): void {
  logger.info('Query sanitized for potential injection', {
    userId: req.auth?.userId,
    riskLevel: result.riskLevel,
  });
  (req.body as QueryBody).query = result.sanitizedQuery;
}

/**
 * Applies the outcome of an injection check: logs detections, rejects
 * high-risk queries, and sanitizes medium-risk ones in place.
 * @param req - Incoming request being guarded
 * @param res - Used to send a 400 envelope when the query is rejected
 * @param queryText - The original query text that was checked
 * @param result - The injection check result to act on
 * @returns `true` if the request was already responded to (caller must stop), else `false`
 */
function handleInjectionResult(
  req: Request,
  res: Response,
  queryText: string,
  result: InjectionCheckResult,
): boolean {
  if (!result.isDetected) {
    return false;
  }

  logInjectionAttempt(queryText, result, req.auth?.userId);

  if (result.riskLevel === 'high') {
    rejectHighRiskInjection(req, res, result);
    return true;
  }

  if (result.riskLevel === 'medium') {
    sanitizeMediumRiskInjection(req, result);
  }

  return false;
}

/**
 * Middleware that validates query text for prompt injection attempts.
 * High-risk injections are rejected with a 400 error, medium-risk injections
 * are sanitized and allowed through, and low-risk or no detection passes
 * through unchanged. Fails open (calls `next()`) if the check itself throws.
 * @param req - Incoming request; expects an optional `body.query` string
 * @param res - Used to send a 400 envelope when a high-risk injection is rejected
 * @param next - Express callback to continue the middleware chain
 * @returns Nothing; always calls `next()` or sends a response
 */
export function promptInjectionGuard(req: Request, res: Response, next: NextFunction): void {
  try {
    // Check if the request has a query field
    const queryText = (req.body as QueryBody | undefined)?.query;

    if (!queryText || typeof queryText !== 'string') {
      // No query to validate, proceed
      return next();
    }

    // Check for injection attempts
    const result = checkPromptInjection(queryText);

    // Log, reject, or sanitize based on the detection outcome
    if (handleInjectionResult(req, res, queryText, result)) {
      return;
    }

    // Proceed with the request
    next();
  } catch (error) {
    logger.error('Error in prompt injection guard', { error });
    // Fail open - if the guard fails, allow the request to proceed
    // This prevents the guard from breaking the application
    next();
  }
}
