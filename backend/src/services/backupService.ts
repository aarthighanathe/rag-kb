/**
 * @file backupService.ts
 * @description On-demand database backup service for Supabase (manual/CLI-triggered, no internal scheduler)
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from '../utils/logger.js';
import { getClient } from './vectorStore.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

const execAsync = promisify(exec);

// ─── Configuration ─────────────────────────────────────────────────────────────

const BACKUP_CONFIG = {
  // Retention policy
  retention: {
    full: 7, // Keep full backups for 7 days
    incremental: 2, // Keep incremental backups for 2 days
  },

  // Storage configuration
  storage: {
    localPath: './backups',
    maxBackupSizeGB: 10, // Maximum size of backup directory
  },

  // Tables to backup (empty = all tables)
  tables: ['documents', 'document_chunks', 'query_logs', 'audit_logs'],
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────────

export type BackupType = 'full' | 'incremental';

export interface BackupResult {
  success: boolean;
  type: BackupType;
  timestamp: Date;
  filePath?: string;
  sizeBytes?: number;
  durationMs: number;
  error?: string;
  tablesBackedUp: string[];
}

export interface BackupInfo {
  type: BackupType;
  timestamp: Date;
  filePath: string;
  sizeBytes: number;
  tables: string[];
}

// ─── Backup Functions ───────────────────────────────────────────────────────────

/**
 * Ensures the backup directory exists, creating it if missing.
 * @returns Resolves once the directory is confirmed to exist
 */
async function ensureBackupDirectory(): Promise<void> {
  try {
    await access(BACKUP_CONFIG.storage.localPath, constants.R_OK | constants.W_OK);
  } catch {
    await mkdir(BACKUP_CONFIG.storage.localPath, { recursive: true });
    logger.info('Created backup directory', { path: BACKUP_CONFIG.storage.localPath });
  }
}

/**
 * Generates a timestamped backup filename for the given backup type.
 * @param type - The kind of backup being named ('full' or 'incremental')
 * @returns A filename in the form `backup-<type>-<ISO timestamp>.sql`
 */
function generateBackupFilename(type: BackupType): string {
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  return `backup-${type}-${date}.sql`;
}

/**
 * Performs a full database backup using pg_dump, falling back to the
 * Supabase SDK JSON export if `DATABASE_URL` is unset or pg_dump fails.
 * @returns The outcome of the backup attempt, including file path and size on success
 */
export async function performFullBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date();

  try {
    await ensureBackupDirectory();

    const filename = generateBackupFilename('full');
    const filePath = join(BACKUP_CONFIG.storage.localPath, filename);

    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      logger.info('DATABASE_URL not set, defaulting to Supabase SDK backup method', { filename });
      return await performSupabaseBackup('full', filePath);
    }

    // Build pg_dump command
    const tablesArg =
      BACKUP_CONFIG.tables.length > 0 ? `-t ${BACKUP_CONFIG.tables.join(' -t ')}` : '';

    const command = `pg_dump "${databaseUrl}" ${tablesArg} --format=plain --no-owner --no-acl > "${filePath}"`;

    logger.info('Starting full database backup via pg_dump', { filename });

    try {
      await execAsync(command);
    } catch (error) {
      // If pg_dump fails, fall back to Supabase SDK backup API
      logger.warn('pg_dump failed or not available, using alternative backup method', { error });
      return await performSupabaseBackup('full', filePath);
    }

    // Get file size
    const stats = await access(filePath)
      .then(() => import('fs'))
      .then((fs) => fs.promises.stat(filePath));
    const sizeBytes = stats.size;

    const durationMs = Date.now() - startTime;

    logger.info('Full database backup completed', {
      filePath,
      sizeBytes,
      durationMs,
      tables: BACKUP_CONFIG.tables,
    });

    return {
      success: true,
      type: 'full',
      timestamp,
      filePath,
      sizeBytes,
      durationMs,
      tablesBackedUp: [...BACKUP_CONFIG.tables],
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Full database backup failed', { error: errorMessage, durationMs });

    return {
      success: false,
      type: 'full',
      timestamp,
      durationMs,
      error: errorMessage,
      tablesBackedUp: [],
    };
  }
}

/**
 * Performs a backup by exporting each configured table's rows as JSON via the
 * Supabase SDK (used as the fallback when pg_dump is unavailable).
 * @param type - The kind of backup being performed ('full' or 'incremental')
 * @param filePath - Destination path for the JSON backup file
 * @returns The outcome of the backup attempt, including file path and size on success
 */
async function performSupabaseBackup(type: BackupType, filePath: string): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date();

  try {
    // Export data from each table as JSON
    const backupData: Record<string, unknown[]> = {};

    for (const table of BACKUP_CONFIG.tables) {
      const { data, error } = await getClient().from(table).select('*');

      if (error) {
        logger.warn(`Failed to backup table ${table}`, { error });
        backupData[table] = [];
      } else {
        backupData[table] = data || [];
      }
    }

    // Write backup to file
    const backupContent = JSON.stringify(backupData, null, 2);
    await writeFile(filePath, backupContent, 'utf-8');

    const sizeBytes = Buffer.byteLength(backupContent, 'utf-8');
    const durationMs = Date.now() - startTime;

    logger.info('Supabase backup completed', {
      type,
      filePath,
      sizeBytes,
      durationMs,
      tables: BACKUP_CONFIG.tables,
    });

    return {
      success: true,
      type,
      timestamp,
      filePath,
      sizeBytes,
      durationMs,
      tablesBackedUp: [...BACKUP_CONFIG.tables],
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Supabase backup failed', { error: errorMessage, durationMs });

    return {
      success: false,
      type,
      timestamp,
      durationMs,
      error: errorMessage,
      tablesBackedUp: [],
    };
  }
}

/**
 * Performs an incremental backup, exporting only rows changed in the last 6 hours.
 * @returns The outcome of the backup attempt, including file path and size on success
 */
export async function performIncrementalBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date();

  try {
    await ensureBackupDirectory();

    const filename = generateBackupFilename('incremental');
    const filePath = join(BACKUP_CONFIG.storage.localPath, filename);

    // For incremental backup, we only backup records modified since last backup
    // This is a simplified version - in production you'd track last backup timestamp
    const lastBackupTime = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago

    const backupData: Record<string, unknown[]> = {};
    const tablesBackedUp: string[] = [];

    for (const table of BACKUP_CONFIG.tables) {
      const timestampCol = table === 'documents' ? 'updated_at' : 'created_at';
      const { data, error } = await getClient()
        .from(table)
        .select('*')
        .gt(timestampCol, lastBackupTime.toISOString());

      if (error) {
        logger.warn(`Failed to backup table ${table}`, { error });
      } else if (data && data.length > 0) {
        backupData[table] = data;
        tablesBackedUp.push(table);
      }
    }

    if (Object.keys(backupData).length === 0) {
      logger.info('No changes detected for incremental backup');

      return {
        success: true,
        type: 'incremental',
        timestamp,
        durationMs: Date.now() - startTime,
        tablesBackedUp: [],
      };
    }

    const backupContent = JSON.stringify(backupData, null, 2);
    await writeFile(filePath, backupContent, 'utf-8');

    const sizeBytes = Buffer.byteLength(backupContent, 'utf-8');
    const durationMs = Date.now() - startTime;

    logger.info('Incremental backup completed', {
      filePath,
      sizeBytes,
      durationMs,
      tables: tablesBackedUp,
    });

    return {
      success: true,
      type: 'incremental',
      timestamp,
      filePath,
      sizeBytes,
      durationMs,
      tablesBackedUp,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Incremental backup failed', { error: errorMessage, durationMs });

    return {
      success: false,
      type: 'incremental',
      timestamp,
      durationMs,
      error: errorMessage,
      tablesBackedUp: [],
    };
  }
}

/**
 * Deletes backup files older than their type's retention window.
 * @returns The number of backup files deleted
 */
export async function cleanupOldBackups(): Promise<number> {
  try {
    const fs = await import('fs/promises');
    const files = await fs.readdir(BACKUP_CONFIG.storage.localPath);

    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      if (!file.startsWith('backup-')) continue;

      const filePath = join(BACKUP_CONFIG.storage.localPath, file);
      const stats = await fs.stat(filePath);
      const ageMs = now - stats.mtime.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      const isFull = file.includes('-full-');
      const retentionDays = isFull
        ? BACKUP_CONFIG.retention.full
        : BACKUP_CONFIG.retention.incremental;

      if (ageDays > retentionDays) {
        await fs.unlink(filePath);
        deletedCount++;
        logger.info('Deleted old backup', { file, ageDays, retentionDays });
      }
    }

    logger.info('Backup cleanup completed', { deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Backup cleanup failed', { error });
    return 0;
  }
}

/**
 * Lists all backups present in the local backup directory, newest first.
 * @returns Metadata for each backup file found
 */
export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const fs = await import('fs/promises');
    const files = await fs.readdir(BACKUP_CONFIG.storage.localPath);

    const backups: BackupInfo[] = [];

    for (const file of files) {
      if (!file.startsWith('backup-')) continue;

      const filePath = join(BACKUP_CONFIG.storage.localPath, file);
      const stats = await fs.stat(filePath);

      const type = file.includes('-full-') ? 'full' : 'incremental';
      const timestamp = new Date(stats.mtime);

      backups.push({
        type,
        timestamp,
        filePath,
        sizeBytes: stats.size,
        tables: [...BACKUP_CONFIG.tables],
      });
    }

    // Sort by timestamp, newest first
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return backups;
  } catch (error) {
    logger.error('Failed to list backups', { error });
    return [];
  }
}

/**
 * Restores a plain-SQL backup (produced by pg_dump in performFullBackup) via psql.
 * @param filePath - Path to the .sql backup file to restore
 * @returns True if the restore succeeded, false otherwise
 */
async function restoreSqlBackup(filePath: string): Promise<boolean> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    logger.error('SQL backup restoration requires DATABASE_URL environment variable', { filePath });
    return false;
  }
  const command = `psql "${databaseUrl}" -f "${filePath}"`;

  try {
    await execAsync(command);
    logger.info('SQL backup restored successfully', { filePath });
    return true;
  } catch (error) {
    logger.error('SQL backup restoration failed', { error, filePath });
    return false;
  }
}

/**
 * Restores a JSON backup (produced by performSupabaseBackup / performIncrementalBackup)
 * by upserting each table's rows via the Supabase client. Tables not present in
 * `BACKUP_CONFIG.tables` are skipped rather than upserted.
 * @param content - Raw JSON backup file content, keyed by table name
 * @param filePath - Path the content was read from, used only for logging
 * @returns True if every recognized table restored successfully, false otherwise
 */
async function restoreJsonBackup(content: string, filePath: string): Promise<boolean> {
  const backupData = JSON.parse(content) as Record<string, unknown>;
  const allowedTables: readonly string[] = BACKUP_CONFIG.tables;

  for (const [table, records] of Object.entries(backupData)) {
    if (!allowedTables.includes(table)) {
      logger.warn(`Skipping restore of unrecognized table ${table}`, { filePath });
      continue;
    }

    if (!Array.isArray(records)) continue;

    if (records.length === 0) continue;

    const { error } = await getClient()
      .from(table)
      .upsert(records as Record<string, unknown>[]);

    if (error) {
      logger.error(`Failed to restore table ${table}`, { error });
      return false;
    }
  }

  logger.info('Backup restored successfully', { filePath });
  return true;
}

/**
 * Restores a backup from file. Detects whether the file is a pg_dump plain-SQL
 * dump or a JSON export (the two formats performFullBackup/performSupabaseBackup
 * can produce) and restores it accordingly.
 * @param filePath - Path to the backup file to restore
 * @returns True if the restore succeeded, false otherwise
 */
export async function restoreBackup(filePath: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    const trimmed = content.trimStart();
    const isJson = trimmed.startsWith('{');

    if (!isJson) {
      return await restoreSqlBackup(filePath);
    }

    return await restoreJsonBackup(content, filePath);
  } catch (error) {
    logger.error('Backup restoration failed', { error, filePath });
    return false;
  }
}

/**
 * Runs the backup tasks appropriate for the current hour (full at 2 AM, incremental
 * every 6 hours) and always prunes expired backups. Intended to be invoked by an
 * external scheduler (e.g. a cron-triggered CLI run); this module does not schedule itself.
 * @returns The results of whichever backup ran this hour, plus the cleanup count
 */
export async function runScheduledBackups(): Promise<{
  full: BackupResult | null;
  incremental: BackupResult | null;
  cleanup: number;
}> {
  logger.info('Starting scheduled backup tasks');

  // Determine which backup to run based on time
  const hour = new Date().getHours();
  const shouldRunFull = hour === 2; // 2 AM
  const shouldRunIncremental = hour % 6 === 0; // Every 6 hours

  let fullResult: BackupResult | null = null;
  let incrementalResult: BackupResult | null = null;

  if (shouldRunFull) {
    fullResult = await performFullBackup();
  } else if (shouldRunIncremental) {
    incrementalResult = await performIncrementalBackup();
  }

  // Always cleanup old backups
  const cleanupResult = await cleanupOldBackups();

  logger.info('Scheduled backup tasks completed', {
    full: fullResult?.success,
    incremental: incrementalResult?.success,
    cleanup: cleanupResult,
  });

  return {
    full: fullResult,
    incremental: incrementalResult,
    cleanup: cleanupResult,
  };
}
