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
import { listStagedFiles, removeFile } from './storage.js';

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
 * Grace period before an orphaned staging-bucket file is eligible for
 * removal. Must be long enough that a file mid-upload (staged, but its
 * `documents` row or BullMQ enqueue hasn't committed yet) is never mistaken
 * for an orphan — upload.ts's own rollback already handles that failure mode
 * synchronously; this only catches files left behind by a harder failure
 * (e.g. a process crash between uploadFile() and createDocument()) that no
 * in-request rollback could run for.
 */
const ORPHAN_STORAGE_GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour

/** Storage keys are `{documentId}_{sanitizedName}` — documentId is always a UUID v4 (see routes/upload.ts). */
const STORAGE_KEY_DOCUMENT_ID_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i;

/**
 * Deletes staging-bucket files with no matching `documents` row — the result
 * of a crash between the file being staged (storage.ts's uploadFile) and the
 * `documents` row being created, a window upload.ts's own in-request
 * rollback cannot cover since the process is gone by the time it would run.
 * Left over indefinitely, these accumulate as unbounded Supabase Storage
 * cost with nothing referencing them.
 * @returns Number of orphaned files removed
 */
export async function reconcileOrphanedStorageFiles(): Promise<number> {
  try {
    const staged = await listStagedFiles();
    if (staged.length === 0) return 0;

    const cutoff = Date.now() - ORPHAN_STORAGE_GRACE_PERIOD_MS;
    const candidates = staged.filter((file) => new Date(file.createdAt).getTime() < cutoff);
    if (candidates.length === 0) return 0;

    const documentIds = candidates
      .map((file) => STORAGE_KEY_DOCUMENT_ID_PATTERN.exec(file.name)?.[1])
      .filter((id): id is string => id !== undefined);

    const { data: existing, error } = await getClient()
      .from('documents')
      .select('id')
      .in('id', documentIds);

    if (error) {
      logger.error('Failed to check documents table during storage reconciliation', {
        error: error.message,
      });
      return 0;
    }

    const existingIds = new Set((existing ?? []).map((row: { id: string }) => row.id));
    const orphans = candidates.filter((file) => {
      const id = STORAGE_KEY_DOCUMENT_ID_PATTERN.exec(file.name)?.[1];
      // No parseable documentId prefix at all is itself orphan-shaped (not a
      // key this app's upload pipeline could have produced), but is left
      // alone rather than deleted — a conservative default in case something
      // else ever legitimately writes to this bucket.
      return id !== undefined && !existingIds.has(id);
    });

    await Promise.all(orphans.map((file) => removeFile(file.name)));

    if (orphans.length > 0) {
      logger.warn('Removed orphaned storage files with no matching documents row', {
        count: orphans.length,
        keys: orphans.map((f) => f.name),
      });
    }
    return orphans.length;
  } catch (error) {
    logger.error('Error during orphaned storage file reconciliation', {
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
  orphanedStorageFiles: number;
  total: number;
}> {
  logger.info('Starting data retention cleanup');

  const [queries, auditLogs, orphanedStorageFiles] = await Promise.all([
    cleanupExpiredQueries(),
    cleanupExpiredAuditLogs(),
    reconcileOrphanedStorageFiles(),
  ]);
  const total = queries + auditLogs + orphanedStorageFiles;

  logger.info('Data retention cleanup completed', {
    queries,
    auditLogs,
    orphanedStorageFiles,
    total,
  });
  return { queries, auditLogs, orphanedStorageFiles, total };
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
