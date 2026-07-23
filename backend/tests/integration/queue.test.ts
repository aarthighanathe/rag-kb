/**
 * @file queue.test.ts
 * @description Integration tests for GET /api/queue/status and GET /api/queue/job/:jobId
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';

const ADMIN_SECRET = 'test-admin-secret-at-least-32-characters-long';

vi.mock('@queues/documentQueue', () => ({
  getQueue: vi.fn(),
  getJobStatus: vi.fn(),
}));

let app: Application;

beforeAll(async () => {
  const { createApp } = await import('../../src/app');
  app = createApp();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/queue/job/:jobId', () => {
  it('returns 422 when jobId is not a valid UUID', async () => {
    const res = await supertest(app)
      .get('/api/queue/job/not-a-uuid')
      .set('X-Admin-Secret', ADMIN_SECRET)
      .expect(422);

    expect(res.body.success).toBe(false);
  });

  it('returns job status when jobId is a valid UUID', async () => {
    const { getJobStatus } = (await import('@queues/documentQueue')) as {
      getJobStatus: ReturnType<typeof vi.fn>;
    };
    getJobStatus.mockResolvedValue({
      jobId: '550e8400-e29b-41d4-a716-446655440001',
      state: 'completed',
      progress: 100,
      timestamp: Date.now(),
    });

    const res = await supertest(app)
      .get('/api/queue/job/550e8400-e29b-41d4-a716-446655440001')
      .set('X-Admin-Secret', ADMIN_SECRET)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.state).toBe('completed');
    expect(getJobStatus).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001');
  });

  it('returns 401 when X-Admin-Secret header is missing', async () => {
    const res = await supertest(app)
      .get('/api/queue/job/550e8400-e29b-41d4-a716-446655440001')
      .expect(401);

    expect(res.body.success).toBe(false);
  });
});
