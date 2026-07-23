/**
 * @file migrate.ts
 * @description Applies SQL migrations from supabase/migrations/ via direct Postgres connection.
 *   Usage: npm run db:migrate  (from backend/)
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);

const MIGRATIONS_TABLE = '_schema_migrations';

/** CLI flags parsed from process.argv. */
interface MigrateOptions {
  status: boolean;
}

/**
 * Parses CLI flags for the migrate script.
 * @returns Parsed options
 */
function parseOptions(): MigrateOptions {
  const args = process.argv.slice(2);
  return {
    status: args.includes('--status'),
  };
}

/**
 * Resolves the Postgres connection string from environment variables.
 * @returns Connection URI
 * @throws When no database URL is configured
 */
function resolveDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'] ?? process.env['SUPABASE_DB_URL'];
  if (!url || url.trim().length === 0) {
    throw new Error(
      [
        'DATABASE_URL is not set in .env',
        '',
        'Add your Supabase Postgres connection string:',
        '  Supabase Dashboard → Project Settings → Database → Connection string → URI',
        '',
        'Example (.env):',
        '  DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres',
        '',
        'Use the database password you set when creating the project (not the service_role API key).',
      ].join('\n'),
    );
  }
  return url.trim();
}

/**
 * Returns migration SQL files in lexical order.
 * @returns Sorted list of absolute file paths
 */
async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (sqlFiles.length === 0) {
    throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
  }

  return sqlFiles.map((name) => path.join(MIGRATIONS_DIR, name));
}

/**
 * Ensures the migration tracking table exists.
 * @param client - Connected Postgres client
 */
async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Returns filenames of migrations already applied.
 * @param client - Connected Postgres client
 * @returns Set of applied migration filenames
 */
async function getAppliedMigrations(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    `SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename`,
  );
  return new Set(result.rows.map((row) => row.filename));
}

/**
 * Applies a single migration file inside a transaction.
 * @param client - Connected Postgres client
 * @param filePath - Absolute path to the .sql file
 */
async function applyMigration(client: pg.Client, filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  const sql = await readFile(filePath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`,
      [filename],
    );
    await client.query('COMMIT');
    console.log(`✓ Applied ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Prints migration status without applying changes.
 * @param client - Connected Postgres client
 * @param files - Migration file paths to report on
 */
async function printStatus(client: pg.Client, files: string[]): Promise<void> {
  const applied = await getAppliedMigrations(client);

  console.log('Migration status:\n');
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const mark = applied.has(filename) ? '✓ applied' : '○ pending';
    console.log(`  ${mark}  ${filename}`);
  }
}

/**
 * Main entry — connect, ensure tracking table, apply pending migrations.
 */
async function main(): Promise<void> {
  const options = parseOptions();
  const databaseUrl = resolveDatabaseUrl();
  const files = await listMigrationFiles();

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await ensureMigrationsTable(client);

    if (options.status) {
      await printStatus(client, files);
      return;
    }

    const applied = await getAppliedMigrations(client);
    const pending = files.filter((f) => !applied.has(path.basename(f)));

    if (pending.length === 0) {
      console.log('All migrations already applied.');
      return;
    }

    console.log(`Applying ${pending.length} migration(s)…\n`);
    for (const filePath of pending) {
      await applyMigration(client, filePath);
    }
    console.log('\nDone. Restart the backend if it is running.');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nMigration failed: ${message}`);
  process.exit(1);
});
