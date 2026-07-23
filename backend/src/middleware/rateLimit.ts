/**
 * @file rateLimit.ts
 * @description Express rate-limit middleware — separate limits per route group
 *
 * Threat model:
 *  - globalRateLimit    → generic DDoS / credential stuffing (A07)
 *  - uploadRateLimit    → HuggingFace API cost amplification; each upload triggers
 *                         embedding calls costing real money (A04 Insecure Design)
 *  - queryRateLimit     → HuggingFace + Groq cost amplification (A04)
 *  - documentsRateLimit → cheap read-only endpoint still needs protection against
 *                         scraping and enumeration attacks (A01)
 *
 * All limiters use:
 *  - standardHeaders: true  → RFC-compliant RateLimit-* response headers
 *  - legacyHeaders: false   → no deprecated X-RateLimit-* headers
 *  - Retry-After header     → tells clients when to retry (avoids thundering herd)
 *  - Consistent error envelope → same shape as all other error responses
 *  - IP + future user-ID    → keyGenerator slot reserved for auth-aware keying
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ─── Shared error code ────────────────────────────────────────────────────────

const RATE_LIMIT_ERROR_CODE = 'RATE_LIMIT_EXCEEDED';

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a rate limiter with per-IP keying, structured logging, and a consistent
 * error envelope that matches the rest of the API (success/error/correlationId).
 *
 * @param max - Maximum requests allowed in the window
 * @param windowMs - Rolling time window in milliseconds
 * @param humanMessage - Human-readable message returned on 429
 * @returns Configured express-rate-limit middleware
 */
function createLimiter(
  max: number,
  windowMs: number,
  humanMessage: string,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    // RFC-compliant RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers.
    standardHeaders: true,
    // Suppress deprecated X-RateLimit-* headers.
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      logger.warn('Rate limit exceeded', {
        correlationId: req.correlationId,
        ip: req.ip,
        path: req.path,
        limit: max,
        windowMs,
      });

      // Retry-After: seconds until the window resets — prevents thundering-herd retries.
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));

      // Consistent envelope — same shape as all other error responses in this API.
      res.status(options.statusCode).json({
        success: false,
        error: {
          code: RATE_LIMIT_ERROR_CODE,
          message: humanMessage,
        },
        correlationId: req.correlationId ?? 'unknown',
      });
    },
    // Key by IP.  When authentication is added, append user ID here so authenticated
    // users get their own quota rather than sharing the IP-level bucket.
    keyGenerator: (req) => req.ip ?? 'unknown',
  });
}

// ─── Limiter instances ────────────────────────────────────────────────────────

/**
 * Global limiter — applied to every route.
 * 200 req / window.  Primary DDoS mitigation layer.
 */
export const globalRateLimit = createLimiter(
  200,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many requests — please slow down and try again later.',
);

/**
 * Upload limiter — applied to POST /api/upload.
 * Default 5 req / window.  Each upload spawns HuggingFace embedding calls.
 * Threat: cost amplification — a single IP could drain API quota in seconds.
 */
export const uploadRateLimit = createLimiter(
  env.RATE_LIMIT_MAX_UPLOAD,
  env.RATE_LIMIT_WINDOW_MS,
  `Upload limit: max ${env.RATE_LIMIT_MAX_UPLOAD} uploads per ${env.RATE_LIMIT_WINDOW_MS / 1000}s.`,
);

/**
 * Query limiter — applied to POST /api/query and GET /api/query/stream.
 * Default 30 req / window.  Each query triggers HuggingFace + Groq inference.
 * Threat: cost amplification; Groq has per-minute token limits.
 */
export const queryRateLimit = createLimiter(
  env.RATE_LIMIT_MAX_QUERY,
  env.RATE_LIMIT_WINDOW_MS,
  `Query limit: max ${env.RATE_LIMIT_MAX_QUERY} queries per ${env.RATE_LIMIT_WINDOW_MS / 1000}s.`,
);

/**
 * Documents limiter — applied to GET/DELETE /api/documents.
 * Default 100 req / window.  Read-only but protects against enumeration scraping.
 * Threat: A01 — unlimited listing lets an attacker map all document IDs.
 */
export const documentsRateLimit = createLimiter(
  env.RATE_LIMIT_MAX_DOCUMENTS,
  env.RATE_LIMIT_WINDOW_MS,
  `Document API limit: max ${env.RATE_LIMIT_MAX_DOCUMENTS} requests per ${env.RATE_LIMIT_WINDOW_MS / 1000}s.`,
);

/**
 * Admin limiter — applied to /api/queue endpoints.
 * Strict 20 req / window to deter brute-force attacks against the X-Admin-Secret header.
 * Threat: A07 Identification and Authentication Failures — repeated guessing of the secret.
 */
export const adminRateLimit = createLimiter(
  20,
  env.RATE_LIMIT_WINDOW_MS,
  `Admin API limit: max 20 requests per ${env.RATE_LIMIT_WINDOW_MS / 1000}s.`,
);
