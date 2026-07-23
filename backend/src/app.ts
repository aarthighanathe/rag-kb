/**
 * @file app.ts
 * @description Express 5 application factory — middleware wiring, route mounting, Swagger UI
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import express, { type Application } from 'express';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { securityMiddleware } from './middleware/security.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import {
  uploadRateLimit,
  queryRateLimit,
  globalRateLimit,
  documentsRateLimit,
  adminRateLimit,
} from './middleware/rateLimit.js';
import uploadRouter from './routes/upload.js';
import queryRouter from './routes/query.js';
import documentsRouter from './routes/documents.js';
import queueRouter from './routes/queue.js';
import { swaggerSpec } from './swagger/spec.js';
import { logger } from './utils/logger.js';
import { checkReadiness } from './utils/readiness.js';

/** Stream adapter that pipes morgan HTTP access logs through Winston. */
const httpLogStream: { write: (message: string) => void } = {
  write: (message: string): void => {
    logger.info(message.trim(), { source: 'http' });
  },
};

/**
 * Creates and configures the Express application.
 * Exported separately from index.ts so Supertest can import without starting the server.
 * @returns Configured Express application instance
 */
export function createApp(): Application {
  const app = express();

  // ── 0. Trust proxy ─────────────────────────────────────────────────────
  // Deployed behind exactly one reverse proxy (PaaS load balancer / edge
  // proxy), so trust only the first hop's X-Forwarded-For entry. Without
  // this, req.ip resolves to the proxy's own address — every client
  // collapses into one rate-limit bucket — and with a naive `true` it would
  // trust an arbitrary number of attacker-supplied X-Forwarded-For hops.
  // `1` trusts exactly one hop, which is what keyGenerator in rateLimit.ts
  // (`req.ip`) relies on to bucket by real client IP.
  app.set('trust proxy', 1);

  // ── 1. Security (Helmet + CORS) — before anything else ───────────────────
  securityMiddleware(app);

  // ── 2. Correlation ID — must tag all subsequent logs ─────────────────────
  app.use(correlationIdMiddleware);

  // ── 3. HTTP access logging via Morgan → Winston ──────────────────────────
  app.use(morgan('combined', { stream: httpLogStream }));

  // ── 4. Body parsing ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── 5. Global rate limit (applied before all routes) ─────────────────────
  app.use(globalRateLimit);

  // ── 6. Health checks (no auth, no rate limit beyond global) ──────────────
  // Pure liveness — "the process is up and can answer HTTP requests" only.
  // Orchestrators that just need "is the process alive, restart if not"
  // should point here, not at /api/health.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness — verifies Supabase and Redis are actually reachable before
  // claiming the instance is fit to receive traffic. Returns 503 if either
  // dependency fails, so a load balancer / orchestrator can cycle the
  // instance out of rotation instead of routing real users into 500s.
  app.get('/api/health', async (req, res) => {
    const readiness = await checkReadiness();
    res.status(readiness.status === 'ok' ? 200 : 503).json({
      success: readiness.status === 'ok',
      data: { status: readiness.status, timestamp: new Date().toISOString(), checks: readiness.checks },
      meta: { correlationId: req.correlationId },
    });
  });

  // ── 7. Swagger UI at /api/docs ────────────────────────────────────────────
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

  // ── 8. API routes ─────────────────────────────────────────────────────────
  // requireAuth gates every route below except GET /api/query/stream, which is opened
  // via native EventSource (cannot send an Authorization header) — see query.ts for
  // how that route inherits its caller's identity from the authenticated POST instead.
  app.use('/api/upload', uploadRateLimit, requireAuth, uploadRouter);
  app.use('/api/query', queryRateLimit, queryRouter);
  app.use('/api/documents', documentsRateLimit, requireAuth, documentsRouter);
  // Admin queue endpoints: strict rate limit (20/window) to deter brute-forcing the admin secret
  app.use('/api/queue', adminRateLimit, queueRouter);

  // ── 9. 404 handler ───────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      correlationId: req.correlationId ?? 'unknown',
    });
  });

  // ── 10. Global error handler (must be last, 4-arity signature) ───────────
  app.use(errorHandler);

  logger.info('Express application configured');
  return app;
}
