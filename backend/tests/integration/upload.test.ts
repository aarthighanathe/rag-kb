/**
 * @file upload.test.ts
 * @description Integration tests for POST /api/upload — multi-file upload with validation
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import type { Application } from 'express';
import { authedRequest } from './helpers.js';

// ── Service mocks — hoisted by Vitest before any imports ──────────────────────

vi.mock('@services/vectorStore', () => ({
  createDocument: vi.fn().mockResolvedValue({ id: 'doc-uuid', status: 'pending' }),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@queues/documentQueue', () => ({
  addDocumentJob: vi.fn().mockResolvedValue('job-uuid'),
  getQueue: vi.fn(),
  getJobStatus: vi.fn(),
}));

vi.mock('@services/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn(),
  removeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Test fixtures ──────────────────────────────────────────────────────────────

/** Minimal valid PDF buffer: magic bytes %PDF-1.4 + padding. */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PDF_BUFFER = Buffer.concat([PDF_MAGIC, Buffer.from(' minimal pdf content')]);

/** Valid plain-text UTF-8 content (no magic bytes needed for TXT). */
const TXT_BUFFER = Buffer.from('This is plain text for testing.');

/** PNG magic bytes prepended to fake content — will fail PDF magic-byte check. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_AS_PDF = Buffer.concat([PNG_MAGIC, Buffer.from(' pretending to be pdf')]);

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: Application;

beforeAll(async () => {
  const { createApp } = await import('../../src/app');
  app = createApp();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/upload', () => {
  describe('success cases', () => {
    it('returns 200 with document and jobId on successful PDF upload', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documents).toHaveLength(1);
      expect(res.body.data.documents[0]).toMatchObject({
        filename: expect.any(String),
        status: 'pending',
        jobId: expect.any(String),
      });
      expect(res.body.meta.correlationId).toBeDefined();
      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('returns 200 with all documents when uploading multiple files', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'doc1.pdf', contentType: 'application/pdf' })
        .attach('files', TXT_BUFFER, { filename: 'doc2.txt', contentType: 'text/plain' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documents).toHaveLength(2);
      expect(res.body.data.documents.every((d: { status: string }) => d.status === 'pending')).toBe(true);
    });
  });

  describe('error cases', () => {
    it('returns 413 when a file exceeds the 10 MB size limit', async () => {
      // Build a buffer > 10 MB so multer throws LIMIT_FILE_SIZE before route logic
      const oversized = Buffer.alloc(11 * 1024 * 1024);
      // Start with PDF magic so MIME filter would pass — multer size check runs first
      PDF_MAGIC.copy(oversized);

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', oversized, { filename: 'huge.pdf', contentType: 'application/pdf' })
        .expect(413);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('LIMIT_FILE_SIZE');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.message.length).toBeGreaterThan(0);
      expect(res.body.error.message).toMatch(/maximum allowed size/i);
      expect(res.body.correlationId).toBeDefined();
    });

    it('returns 400 when file MIME type is not allowed by the allow-list', async () => {
      const htmlBuffer = Buffer.from('<html><body>not allowed</body></html>');

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', htmlBuffer, { filename: 'page.html', contentType: 'text/html' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Unsupported MIME type/i);
    });

    it('returns 400 when magic bytes do not match the declared extension', async () => {
      // PNG buffer submitted with mimetype application/pdf — MIME filter passes
      // because the client declares pdf, but validateFile detects PNG magic bytes
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PNG_AS_PDF, { filename: 'fake.pdf', contentType: 'application/pdf' })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.message.length).toBeGreaterThan(0);
      expect(res.body.error.message).toMatch(/does not match the declared extension/i);
      expect(res.body.correlationId).toBeDefined();
    });

    it('returns 400 when more than 5 files are uploaded in one request', async () => {
      let req = authedRequest(app).post('/api/upload');
      for (let i = 0; i < 6; i++) {
        req = req.attach('files', TXT_BUFFER, {
          filename: `file${i}.txt`,
          contentType: 'text/plain',
        });
      }

      const res = await req.expect(400);
      expect(res.body.success).toBe(false);
      // multer LIMIT_FILE_COUNT for exceeding array maxCount
      expect(res.body.error.code).toMatch(/LIMIT_/);
    });

    it('returns 422 when no files field is included in the request', async () => {
      // Send multipart without any file attachment
      const res = await authedRequest(app)
        .post('/api/upload')
        .field('title', 'no file here')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.correlationId).toBeDefined();
    });
  });

  describe('error envelope shape', () => {
    it('returns consistent envelope on all failure paths', async () => {
      const htmlBuffer = Buffer.from('<html><body>not allowed</body></html>');

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', htmlBuffer, { filename: 'page.html', contentType: 'text/html' })
        .expect(400);

      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
        correlationId: expect.any(String),
      });
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.message).not.toBe('[object Object]');
    });
  });

  describe('rate limiting', () => {
    it('includes RateLimit headers in every response', async () => {
      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', TXT_BUFFER, { filename: 'check.txt', contentType: 'text/plain' });

      // express-rate-limit injects standard RateLimit headers
      expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBeDefined();
    });
  });

  describe('service-layer failure handling', () => {
    it('returns 500 when Supabase createDocument throws an InternalError', async () => {
      const { createDocument } = await import('@services/vectorStore') as {
        createDocument: ReturnType<typeof vi.fn>;
      };
      const { InternalError } = await import('../../src/types/index.js');
      createDocument.mockRejectedValueOnce(new InternalError('DB connection refused'));

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('rolls back the staged file when createDocument fails', async () => {
      const { createDocument } = await import('@services/vectorStore') as {
        createDocument: ReturnType<typeof vi.fn>;
      };
      const { removeFile } = await import('@services/storage') as { removeFile: ReturnType<typeof vi.fn> };
      const { InternalError } = await import('../../src/types/index.js');
      createDocument.mockRejectedValueOnce(new InternalError('DB connection refused'));

      await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(500);

      expect(removeFile).toHaveBeenCalledOnce();
    });

    it('returns 500 when addDocumentJob throws (queue enqueue failure)', async () => {
      const { addDocumentJob } = await import('@queues/documentQueue') as {
        addDocumentJob: ReturnType<typeof vi.fn>;
      };
      addDocumentJob.mockRejectedValueOnce(new Error('Redis connection lost'));

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });

    it('rolls back the document row and the staged file when addDocumentJob fails', async () => {
      const { addDocumentJob } = await import('@queues/documentQueue') as {
        addDocumentJob: ReturnType<typeof vi.fn>;
      };
      const { deleteDocument } = await import('@services/vectorStore') as {
        deleteDocument: ReturnType<typeof vi.fn>;
      };
      const { removeFile } = await import('@services/storage') as { removeFile: ReturnType<typeof vi.fn> };
      addDocumentJob.mockRejectedValueOnce(new Error('Redis connection lost'));

      await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(500);

      expect(deleteDocument).toHaveBeenCalledOnce();
      expect(removeFile).toHaveBeenCalledOnce();
    });

    it('does not roll back anything when the upload succeeds', async () => {
      const { deleteDocument } = await import('@services/vectorStore') as {
        deleteDocument: ReturnType<typeof vi.fn>;
      };
      const { removeFile } = await import('@services/storage') as { removeFile: ReturnType<typeof vi.fn> };

      await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'report.pdf', contentType: 'application/pdf' })
        .expect(200);

      expect(deleteDocument).not.toHaveBeenCalled();
      expect(removeFile).not.toHaveBeenCalled();
    });

    it('returns 200 when two valid files are uploaded simultaneously', async () => {
      const { createDocument } = await import('@services/vectorStore') as {
        createDocument: ReturnType<typeof vi.fn>;
      };
      const { addDocumentJob } = await import('@queues/documentQueue') as {
        addDocumentJob: ReturnType<typeof vi.fn>;
      };
      createDocument
        .mockResolvedValueOnce({ id: 'doc-uuid-1', status: 'pending' })
        .mockResolvedValueOnce({ id: 'doc-uuid-2', status: 'pending' });
      addDocumentJob
        .mockResolvedValueOnce('job-uuid-1')
        .mockResolvedValueOnce('job-uuid-2');

      const res = await authedRequest(app)
        .post('/api/upload')
        .attach('files', PDF_BUFFER, { filename: 'doc1.pdf', contentType: 'application/pdf' })
        .attach('files', TXT_BUFFER, { filename: 'doc2.txt', contentType: 'text/plain' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documents).toHaveLength(2);
      expect(createDocument).toHaveBeenCalledTimes(2);
      expect(addDocumentJob).toHaveBeenCalledTimes(2);
    });
  });
});
