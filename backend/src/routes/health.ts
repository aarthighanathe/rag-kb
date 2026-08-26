/**
 * @file health.ts
 * @description Health check endpoints for monitoring/orchestrators — thin routing layer
 *   over the dependency checks already implemented in utils/readiness.ts (used at boot
 *   and by GET /api/health). Deliberately does not duplicate that check logic: an earlier
 *   version of this file re-implemented its own Supabase/HuggingFace/Groq checks with a
 *   second Supabase client and no Redis check at all, which would have drifted from
 *   readiness.ts over time. This file only adds route *shapes* (`/detailed`, `/ready`,
 *   `/live`) that Kubernetes-style orchestrators conventionally expect, mapped onto the
 *   one shared readiness check.
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { Router, type Request, type Response } from 'express';
import { checkReadiness } from '../utils/readiness.js';

const router = Router();

/**
 * GET /health/
 * Basic liveness — the process is up and can answer HTTP requests. Does not
 * check any dependency; mirrors the top-level GET /health in app.ts.
 */
router.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /health/detailed
 * Full dependency breakdown (Supabase, Redis, HuggingFace, Groq), each with
 * its own ok/error status. 503 if any dependency is down.
 */
router.get('/detailed', async (_req: Request, res: Response): Promise<void> => {
  const readiness = await checkReadiness();
  res.status(readiness.status === 'ok' ? 200 : 503).json({
    status: readiness.status === 'ok' ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: readiness.checks,
  });
});

/**
 * GET /health/ready
 * Readiness probe — 200 only if every dependency is reachable, so an
 * orchestrator can hold traffic back from an instance that's up but not
 * actually able to serve requests (e.g. Supabase or Redis unreachable).
 */
router.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const readiness = await checkReadiness();
  if (readiness.status === 'ok') {
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res
      .status(503)
      .json({ status: 'not_ready', timestamp: new Date().toISOString(), checks: readiness.checks });
  }
});

/**
 * GET /health/live
 * Liveness probe — process is alive, no dependency checks. An orchestrator
 * should restart the instance if this doesn't respond, but should NOT use
 * this to gate traffic routing (that's /ready's job) — a dependency outage
 * is not a reason to kill and restart an otherwise-healthy process.
 */
router.get('/live', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

export default router;
