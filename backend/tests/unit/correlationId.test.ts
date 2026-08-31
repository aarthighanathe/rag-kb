/**
 * @file correlationId.test.ts
 * @description Unit/integration tests for correlationIdMiddleware — verifies
 *   both the existing req.correlationId/response-header behavior and the
 *   AsyncLocalStorage wiring that lets service-layer code log with the
 *   request's correlationId automatically, without receiving it as a
 *   parameter (the gap flagged in the CLAUDE.md rule-compliance review).
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import Transport from 'winston-transport';
import { correlationIdMiddleware, CORRELATION_ID_HEADER } from '../../src/middleware/correlationId';

// tests/setup.ts globally mocks the logger — this file verifies the real
// AsyncLocalStorage + Winston wiring, so it opts back in to the real module.
vi.unmock('../../src/utils/logger');
const { logger } = await import('../../src/utils/logger');

/** Winston transport that records every info object it receives, for assertions. */
class CapturingTransport extends Transport {
  captured: Record<string, unknown>[] = [];
  override log(info: Record<string, unknown>, callback: () => void): void {
    this.captured.push(info);
    callback();
  }
}

/**
 * Simulates a service-layer function that has no idea a correlationId
 * exists — it never receives one as a parameter, matching the shape of
 * real functions like vectorStore.ts's upsertChunks or llm.ts's
 * streamCompletion. If the AsyncLocalStorage wiring works, its log line
 * still carries the request's correlationId.
 */
async function serviceLayerCallWithNoCorrelationIdParam(): Promise<void> {
  await Promise.resolve(); // force a real async boundary, like a DB/API call
  logger.error('service-layer log with no correlationId param');
}

describe('correlationIdMiddleware — AsyncLocalStorage propagation to service-layer logs', () => {
  it('attaches req.correlationId and echoes the response header (existing behavior)', async () => {
    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/test', (req: Request, res: Response) => {
      res.json({ correlationId: req.correlationId });
    });

    const res = await request(app).get('/test');

    expect(res.headers[CORRELATION_ID_HEADER.toLowerCase()]).toBeDefined();
    expect(res.body.correlationId).toBe(res.headers[CORRELATION_ID_HEADER.toLowerCase()]);
  });

  it('propagates the client-supplied correlation ID into a service-layer log call across a real async boundary', async () => {
    const capturing = new CapturingTransport();
    logger.add(capturing);

    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/test', (_req: Request, res: Response) => {
      serviceLayerCallWithNoCorrelationIdParam()
        .then(() => res.json({ ok: true }))
        .catch(() => res.status(500).json({ ok: false }));
    });

    try {
      await request(app).get('/test').set(CORRELATION_ID_HEADER, 'my-custom-correlation-id');
    } finally {
      logger.remove(capturing);
    }

    const serviceLog = capturing.captured.find(
      (entry) => entry['message'] === 'service-layer log with no correlationId param',
    );
    expect(serviceLog).toBeDefined();
    expect(serviceLog?.['correlationId']).toBe('my-custom-correlation-id');
  });

  it('does not leak one request\'s correlationId into a concurrent request\'s service-layer logs', async () => {
    const capturing = new CapturingTransport();
    logger.add(capturing);

    const app = express();
    app.use(correlationIdMiddleware);
    app.get('/test', (_req: Request, res: Response) => {
      serviceLayerCallWithNoCorrelationIdParam()
        .then(() => res.json({ ok: true }))
        .catch(() => res.status(500).json({ ok: false }));
    });

    try {
      await Promise.all([
        request(app).get('/test').set(CORRELATION_ID_HEADER, 'req-alpha'),
        request(app).get('/test').set(CORRELATION_ID_HEADER, 'req-beta'),
      ]);
    } finally {
      logger.remove(capturing);
    }

    const serviceLogs = capturing.captured.filter(
      (entry) => entry['message'] === 'service-layer log with no correlationId param',
    );
    const correlationIds = serviceLogs.map((entry) => entry['correlationId']).sort();
    expect(correlationIds).toEqual(['req-alpha', 'req-beta']);
  });
});
