/**
 * @file queue.ts
 * @description Admin-only queue monitoring endpoints — requires X-Admin-Secret header
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import crypto from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getQueue, getJobStatus } from '../queues/documentQueue.js';
import { AppError } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { JobIdParamSchema } from '../schemas/queue.schema.js';

const router = Router();

/**
 * Middleware that validates the X-Admin-Secret header.
 * Returns 401 if the header is missing and 403 if it doesn't match ADMIN_SECRET.
 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-admin-secret'];
  if (!secret) {
    next(new AppError('Missing X-Admin-Secret header', 401));
    return;
  }
  const secretBuf = Buffer.from(String(secret));
  const expectedBuf = Buffer.from(env.ADMIN_SECRET);
  if (secretBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
    logger.warn('Unauthorized admin queue access attempt', {
      correlationId: req.correlationId,
      ip: req.ip,
    });
    next(new AppError('Invalid admin secret', 403));
    return;
  }
  next();
}

/**
 * GET /api/queue/status
 * Returns current job counts across all queue states.
 * Useful for dashboards and alerting on queue depth.
 */
router.get(
  '/status',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const queue = getQueue();
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      res.json({
        success: true,
        data: { waiting, active, completed, failed, delayed, queueName: queue.name },
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/queue/job/:jobId
 * Returns state, progress, result, and failure reason for a specific job.
 * jobId equals the documentId for all document processing jobs.
 */
router.get(
  '/job/:jobId',
  requireAdmin,
  validate(JobIdParamSchema, 'params'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params as unknown as { jobId: string };

      const status = await getJobStatus(jobId);
      res.json({
        success: true,
        data: status,
        meta: { correlationId: req.correlationId },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
