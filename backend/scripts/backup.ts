/**
 * @file backup.ts
 * @description CLI entry point dispatching to backupService.ts subcommands.
 *   Usage: npm run backup:full | backup:incremental | backup:list | backup:cleanup
 *          npm run backup:restore -- --file ./backups/backup-full-<timestamp>.sql
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import {
  performFullBackup,
  performIncrementalBackup,
  listBackups,
  restoreBackup,
  cleanupOldBackups,
} from '../src/services/backupService.js';

type Subcommand = 'full' | 'incremental' | 'list' | 'restore' | 'cleanup';

const KNOWN_SUBCOMMANDS: readonly Subcommand[] = ['full', 'incremental', 'list', 'restore', 'cleanup'];

/**
 * Parses CLI flags for the backup script.
 * @returns Parsed subcommand and optional restore file path
 * @throws When the subcommand is missing or unrecognized
 */
function parseOptions(): { subcommand: Subcommand; file: string | undefined } {
  const args = process.argv.slice(2);
  const [rawSubcommand, ...rest] = args;

  if (!rawSubcommand || !KNOWN_SUBCOMMANDS.includes(rawSubcommand as Subcommand)) {
    throw new Error(
      `Usage: tsx scripts/backup.ts <${KNOWN_SUBCOMMANDS.join('|')}> [--file <path>]`,
    );
  }

  const fileFlagIndex = rest.indexOf('--file');
  const file = fileFlagIndex !== -1 ? rest[fileFlagIndex + 1] : undefined;

  return { subcommand: rawSubcommand as Subcommand, file };
}

/**
 * Runs the full backup subcommand and reports the result.
 */
async function runFull(): Promise<void> {
  const result = await performFullBackup();
  if (!result.success) {
    throw new Error(result.error ?? 'Full backup failed');
  }
  console.log(`✓ Full backup complete: ${result.filePath ?? '(no file path)'} (${String(result.sizeBytes ?? 0)} bytes)`);
}

/**
 * Runs the incremental backup subcommand and reports the result.
 */
async function runIncremental(): Promise<void> {
  const result = await performIncrementalBackup();
  if (!result.success) {
    throw new Error(result.error ?? 'Incremental backup failed');
  }
  if (result.tablesBackedUp.length === 0) {
    console.log('✓ Incremental backup: no changes detected');
    return;
  }
  console.log(`✓ Incremental backup complete: ${result.filePath ?? '(no file path)'} (${String(result.sizeBytes ?? 0)} bytes)`);
}

/**
 * Lists available backups and prints them to stdout.
 */
async function runList(): Promise<void> {
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log('No backups found.');
    return;
  }
  console.log('Available backups:\n');
  for (const backup of backups) {
    console.log(`  [${backup.type}]  ${backup.filePath}  (${String(backup.sizeBytes)} bytes, ${backup.timestamp.toISOString()})`);
  }
}

/**
 * Restores a backup from the given file path.
 * @param file - Path to the backup file, from --file
 * @throws When --file was not provided or the restore fails
 */
async function runRestore(file: string | undefined): Promise<void> {
  if (!file) {
    throw new Error('Missing required --file <path> for restore');
  }
  const success = await restoreBackup(file);
  if (!success) {
    throw new Error(`Restore failed for ${file}`);
  }
  console.log(`✓ Restore complete from ${file}`);
}

/**
 * Runs the cleanup subcommand and reports how many backups were deleted.
 */
async function runCleanup(): Promise<void> {
  const deletedCount = await cleanupOldBackups();
  console.log(`✓ Cleanup complete: ${String(deletedCount)} old backup(s) deleted`);
}

/**
 * Main entry — parses argv and dispatches to the matching backupService function.
 */
async function main(): Promise<void> {
  const { subcommand, file } = parseOptions();

  switch (subcommand) {
    case 'full':
      await runFull();
      break;
    case 'incremental':
      await runIncremental();
      break;
    case 'list':
      await runList();
      break;
    case 'restore':
      await runRestore(file);
      break;
    case 'cleanup':
      await runCleanup();
      break;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nBackup command failed: ${message}`);
  process.exit(1);
});
