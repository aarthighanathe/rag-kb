/**
 * @file migrate.test.ts
 * @description Unit tests for migration file discovery logic.
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

import { describe, it, expect } from 'vitest';
import { readdir } from 'fs/promises';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

/**
 * Mirrors listMigrationFiles filter logic from migrate.ts for testing.
 * @returns Sorted SQL filenames
 */
async function listMigrationNames(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

describe('db migrate — migration file discovery', () => {
  it('finds 001_initial.sql as the core migration', async () => {
    const files = await listMigrationNames();
    expect(files).toContain('001_initial.sql');
  });

  it('returns only .sql files', async () => {
    const files = await listMigrationNames();
    expect(files.every((name) => name.endsWith('.sql'))).toBe(true);
  });
});
