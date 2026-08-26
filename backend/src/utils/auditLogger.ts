/**
 * @file auditLogger.ts
 * @description Audit logging for this app's sensitive operations — document upload,
 *   document delete, and query submission. Every call both writes a structured Winston
 *   log line (for immediate correlation-ID-based tracing, per CLAUDE.md Rule 14) and
 *   persists a row to the audit_logs table (008_add_audit_logs.sql) for durable,
 *   queryable retention independent of log rotation. Scoped to only the operations this
 *   app actually has routes for — earlier versions of this module defined audit types for
 *   password changes, API keys, and admin user management, none of which this app
 *   implements (auth is delegated entirely to Clerk).
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from './logger.js';
import { insertAuditLog, type AuditOperation } from '../services/vectorStore.js';

export type { AuditOperation };

/** Metadata accepted by logAuditEvent, shared by every operation-specific helper below. */
interface AuditMetadata {
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Logs an audit event: a Winston log line immediately, plus a fire-and-forget
 * persisted row in audit_logs. The DB write is never awaited by the caller —
 * see insertAuditLog's own doc comment for why a failed audit write must
 * never block or fail the operation being audited.
 * @param operation - The type of operation being audited
 * @param success - Whether the operation succeeded
 * @param metadata - Additional metadata about the operation
 */
export function logAuditEvent(
  operation: AuditOperation,
  success: boolean,
  metadata: AuditMetadata = {},
): void {
  const logPayload = { operation, success, ...metadata };
  if (!success) {
    logger.warn('AUDIT', logPayload);
  } else {
    logger.info('AUDIT', logPayload);
  }

  void insertAuditLog({ operation, success, ...metadata }).catch((err: unknown) => {
    logger.warn('Audit event logged but DB persistence threw unexpectedly', {
      operation,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Logs a document upload operation.
 * @param userId - Owner of the uploaded document
 * @param documentId - UUID of the created document row
 * @param fileName - Original filename
 * @param success - Whether the upload succeeded
 * @param correlationId - Request correlation ID, for cross-referencing with app logs
 */
export function logDocumentUpload(
  userId: string,
  documentId: string,
  fileName: string,
  success: boolean,
  correlationId?: string,
): void {
  logAuditEvent('document_upload', success, {
    userId,
    resourceId: documentId,
    resourceType: 'document',
    details: { fileName },
    ...(correlationId && { correlationId }),
  });
}

/**
 * Logs a document deletion operation.
 * @param userId - Owner performing the deletion
 * @param documentId - UUID of the deleted document
 * @param fileName - Original filename, for a readable audit trail without a join
 * @param success - Whether the deletion succeeded
 * @param correlationId - Request correlation ID
 */
export function logDocumentDelete(
  userId: string,
  documentId: string,
  fileName: string,
  success: boolean,
  correlationId?: string,
): void {
  logAuditEvent('document_delete', success, {
    userId,
    resourceId: documentId,
    resourceType: 'document',
    details: { fileName },
    ...(correlationId && { correlationId }),
  });
}

/**
 * Logs a query submission operation.
 * @param userId - User who submitted the query
 * @param queryId - UUID of the query_logs row, once known
 * @param queryLength - Character length of the submitted query text (not the text itself — avoids persisting arbitrary user input into the audit trail)
 * @param success - Whether the query was accepted/processed
 * @param correlationId - Request correlation ID
 */
export function logQuerySubmit(
  userId: string,
  queryId: string,
  queryLength: number,
  success: boolean,
  correlationId?: string,
): void {
  logAuditEvent('query_submit', success, {
    userId,
    resourceId: queryId,
    resourceType: 'query',
    details: { queryLength },
    ...(correlationId && { correlationId }),
  });
}
