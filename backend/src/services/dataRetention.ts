/**
 * @file dataRetention.ts
 * @description Data retention policy and cleanup for this app's actual tables: query_logs
 *   and audit_logs. Scoped down from an earlier version that also referenced a `documents`
 *   soft-delete column (`deleted_at`) and an `upload_queue` table — neither exists in any
 *   migration (documents are hard-deleted immediately, per vectorStore.ts's deleteDocument;
 *   upload state lives entirely in BullMQ, not a Supabase table), so those cleanup paths
 *   would have failed on first invocation. Reuses vectorStore.ts's shared Supabase client
 *   rather than opening a second connection to the same project.
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from '../utils/logger.js';
import { getClient } from './vectorStore.js';

// ─── Retention Periods (in days) ───────────────────────────────────────────────

/**
 * Data retention configuration. All periods are in days.
 */
export const RETENTION_POLICIES = {
  queries: {
    standard: 365, // Query logs retained for 1 year
  },
  auditLogs: {
    standard: 730, // Audit logs retained for 2 years
  },
} as const;

/** Data type categories this service can report on / clean up. */
export enum DataType {
  QUERY = 'query',
  AUDIT_LOG = 'audit_log',
}

/** Retention status for a data record. */
export interface RetentionStatus {
  dataType: DataType;
  isRetained: boolean;
  expiresAt?: Date;
  reason: string;
}

// ─── Retention Calculation ─────────────────────────────────────────────────────

/**
 * Resolves the retention period (in days) for a data record, dispatching by data type.
 * @param dataType - The type of data
 * @returns Retention period in days
 */
function resolveRetentionDays(dataType: DataType): number {
  return dataType === DataType.AUDIT_LOG
    ? RETENTION_POLICIES.auditLogs.standard
    : RETENTION_POLICIES.queries.standard;
}

/**
 * Calculates the expiration date for a data record based on its type and creation date.
 * @param dataType - The type of data
 * @param createdAt - When the record was created
 * @returns Expiration date
 */
export function calculateExpirationDate(dataType: DataType, createdAt: Date): Date {
  const retentionDays = resolveRetentionDays(dataType);
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + retentionDays);
  return expiresAt;
}

/**
 * Checks if a data record should still be retained.
 * @param dataType - The type of data
 * @param createdAt - When the record was created
 * @returns Retention status
 */
export function checkRetentionStatus(dataType: DataType, createdAt: Date): RetentionStatus {
  const expiresAt = calculateExpirationDate(dataType, createdAt);
  const isRetained = new Date() < expiresAt;

  return {
    dataType,
    isRetained,
    expiresAt,
    reason: isRetained ? `Retained until ${expiresAt.toISOString()}` : 'Retention period expired',
  };
}

// ─── Cleanup Functions ────────────────────────────────────────────────────────

/**
 * Deletes expired query logs (older than RETENTION_POLICIES.queries.standard).
 * @returns Number of rows deleted
 */
export async function cleanupExpiredQueries(): Promise<number> {
  try {
    const cutoffDate = new Date(
      Date.now() - RETENTION_POLICIES.queries.standard * 24 * 60 * 60 * 1000,
    );

    const { data, error } = await getClient()
      .from('query_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .select('id');

    if (error) {
      logger.error('Failed to cleanup expired queries', { error: error.message });
      return 0;
    }

    const deletedCount = data?.length ?? 0;
    logger.info('Cleaned up expired queries', { deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Error during query cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Deletes expired audit logs (older than RETENTION_POLICIES.auditLogs.standard).
 * @returns Number of rows deleted
 */
export async function cleanupExpiredAuditLogs(): Promise<number> {
  try {
    const cutoffDate = new Date(
      Date.now() - RETENTION_POLICIES.auditLogs.standard * 24 * 60 * 60 * 1000,
    );

    const { data, error } = await getClient()
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .select('id');

    if (error) {
      logger.error('Failed to cleanup expired audit logs', { error: error.message });
      return 0;
    }

    const deletedCount = data?.length ?? 0;
    logger.info('Cleaned up expired audit logs', { deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Error during audit log cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Runs all cleanup tasks.
 * @returns Summary of cleanup results
 */
export async function runAllCleanupTasks(): Promise<{
  queries: number;
  auditLogs: number;
  total: number;
}> {
  logger.info('Starting data retention cleanup');

  const [queries, auditLogs] = await Promise.all([
    cleanupExpiredQueries(),
    cleanupExpiredAuditLogs(),
  ]);
  const total = queries + auditLogs;

  logger.info('Data retention cleanup completed', { queries, auditLogs, total });
  return { queries, auditLogs, total };
}

/**
 * Gets a summary of data that will be deleted in the next cleanup.
 * @returns Summary of expiring data counts
 */
export async function getExpiringDataSummary(): Promise<{ queries: number; auditLogs: number }> {
  try {
    const queryCutoff = new Date(
      Date.now() - RETENTION_POLICIES.queries.standard * 24 * 60 * 60 * 1000,
    );
    const auditLogCutoff = new Date(
      Date.now() - RETENTION_POLICIES.auditLogs.standard * 24 * 60 * 60 * 1000,
    );

    const [queries, auditLogs] = await Promise.all([
      getClient()
        .from('query_logs')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', queryCutoff.toISOString()),
      getClient()
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', auditLogCutoff.toISOString()),
    ]);

    return { queries: queries.count ?? 0, auditLogs: auditLogs.count ?? 0 };
  } catch (error) {
    logger.error('Failed to get expiring data summary', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { queries: 0, auditLogs: 0 };
  }
}
