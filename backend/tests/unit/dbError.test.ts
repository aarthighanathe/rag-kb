/**
 * @file dbError.test.ts
 * @description Unit tests for Supabase error message mapping.
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

import { describe, it, expect } from 'vitest';
import { toDbInternalError, DbErrorCode } from '../../src/utils/dbError.js';
import { InternalError } from '../../src/types/index.js';

describe('toDbInternalError', () => {
  it('maps fetch failed to a user-facing database message', () => {
    const err = toDbInternalError('Failed to list documents', 'TypeError: fetch failed');
    expect(err).toBeInstanceOf(InternalError);
    expect(err.message).toMatch(/database service is unavailable/i);
    expect(err.message).not.toContain('TypeError');
  });

  it('tags connectivity failures with DbErrorCode.CONNECTIVITY', () => {
    const err = toDbInternalError('Failed to list documents', 'TypeError: fetch failed');
    expect(err.code).toBe(DbErrorCode.CONNECTIVITY);
  });

  it('preserves non-connectivity errors with context', () => {
    const err = toDbInternalError('Failed to create document', 'duplicate key value');
    expect(err.message).toBe('Failed to create document: duplicate key value');
  });

  it('tags generic (non-connectivity, non-schema) errors with DbErrorCode.GENERIC', () => {
    const err = toDbInternalError('Failed to create document', 'duplicate key value');
    expect(err.code).toBe(DbErrorCode.GENERIC);
  });

  it('maps missing table errors to a migration hint', () => {
    const err = toDbInternalError(
      'Failed to list documents',
      "Could not find the table 'public.documents' in the schema cache",
    );
    expect(err.message).toMatch(/database schema is not set up/i);
    expect(err.message).toMatch(/db:migrate/i);
  });

  it('tags missing-table errors with DbErrorCode.SCHEMA_NOT_MIGRATED', () => {
    const err = toDbInternalError(
      'Failed to list documents',
      "Could not find the table 'public.documents' in the schema cache",
    );
    expect(err.code).toBe(DbErrorCode.SCHEMA_NOT_MIGRATED);
  });
});
