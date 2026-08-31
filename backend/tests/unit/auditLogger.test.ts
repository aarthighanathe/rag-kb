/**
 * @file auditLogger.test.ts
 * @description Unit tests for audit logging — verifies log calls carry the right fields
 *   and that a failing DB persistence write never throws or rejects (audit logging must
 *   never break the request it is logging).
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { insertAuditLogMock } = vi.hoisted(() => ({ insertAuditLogMock: vi.fn() }));
vi.mock('../../src/services/vectorStore', () => ({
  insertAuditLog: insertAuditLogMock,
}));

import {
  logAuditEvent,
  logDocumentUpload,
  logDocumentDelete,
  logQuerySubmit,
} from '../../src/utils/auditLogger';
import { logger } from '../../src/utils/logger';

beforeEach(() => {
  vi.clearAllMocks();
  insertAuditLogMock.mockResolvedValue(undefined);
});

describe('logAuditEvent', () => {
  it('logs an info line and persists the row on success', () => {
    logAuditEvent('document_upload', true, { userId: 'u1', resourceId: 'd1' });

    expect(logger.info).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({ operation: 'document_upload', success: true, userId: 'u1', resourceId: 'd1' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(insertAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'document_upload', success: true, userId: 'u1', resourceId: 'd1' }),
    );
  });

  it('logs a warn line (not info) on failure', () => {
    logAuditEvent('document_delete', false, { userId: 'u1' });

    expect(logger.warn).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({ operation: 'document_delete', success: false, userId: 'u1' }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not throw when insertAuditLog rejects — audit logging must never break the caller', async () => {
    insertAuditLogMock.mockRejectedValue(new Error('DB unavailable'));

    expect(() => logAuditEvent('query_submit', true, { userId: 'u1' })).not.toThrow();

    // Allow the fire-and-forget promise chain to settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalledWith(
      'Audit event logged but DB persistence threw unexpectedly',
      expect.objectContaining({ operation: 'query_submit', error: 'DB unavailable' }),
    );
  });

  it('does not await insertAuditLog — returns synchronously (fire-and-forget)', () => {
    insertAuditLogMock.mockReturnValue(new Promise(() => {})); // never resolves
    const start = Date.now();
    logAuditEvent('document_upload', true, {});
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('defaults metadata to an empty object when omitted', () => {
    logAuditEvent('document_upload', true);
    expect(logger.info).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({ operation: 'document_upload', success: true }),
    );
  });
});

describe('logDocumentUpload', () => {
  it('logs with resourceType "document" and fileName in details', () => {
    logDocumentUpload('user-1', 'doc-1', 'report.pdf', true, 'corr-1');

    expect(logger.info).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({
        operation: 'document_upload',
        success: true,
        userId: 'user-1',
        resourceId: 'doc-1',
        resourceType: 'document',
        details: { fileName: 'report.pdf' },
        correlationId: 'corr-1',
      }),
    );
  });

  it('omits correlationId from the payload when not provided', () => {
    logDocumentUpload('user-1', 'doc-1', 'report.pdf', false);

    const call = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(call).not.toHaveProperty('correlationId');
  });
});

describe('logDocumentDelete', () => {
  it('logs with operation "document_delete" and the deleted filename', () => {
    logDocumentDelete('user-1', 'doc-2', 'notes.txt', true, 'corr-2');

    expect(logger.info).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({
        operation: 'document_delete',
        resourceId: 'doc-2',
        resourceType: 'document',
        details: { fileName: 'notes.txt' },
        correlationId: 'corr-2',
      }),
    );
  });
});

describe('logQuerySubmit', () => {
  it('logs queryLength instead of raw query text (never persists user input)', () => {
    logQuerySubmit('user-1', 'query-1', 42, true, 'corr-3');

    expect(logger.info).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({
        operation: 'query_submit',
        resourceId: 'query-1',
        resourceType: 'query',
        details: { queryLength: 42 },
        correlationId: 'corr-3',
      }),
    );
  });

  it('logs a warning when the query submission failed', () => {
    logQuerySubmit('user-1', 'query-2', 10, false);

    expect(logger.warn).toHaveBeenCalledWith(
      'AUDIT',
      expect.objectContaining({ operation: 'query_submit', success: false }),
    );
  });
});
