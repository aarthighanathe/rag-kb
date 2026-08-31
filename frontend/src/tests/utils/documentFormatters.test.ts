/**
 * @file documentFormatters.test.ts
 * @description Unit tests for the O(n) duplicate-filename detector used by
 *   the Documents page grid/table to flag same-name documents.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect } from 'vitest';
import { getDuplicateFilenameIds } from '../../utils/documentFormatters';
import type { DocumentRecord } from '../../services/api';

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    filename: 'report.pdf',
    original_name: 'report.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1000,
    status: 'ready',
    chunk_count: 5,
    created_at: '2026-06-16T00:00:00Z',
    ...overrides,
  } as DocumentRecord;
}

describe('getDuplicateFilenameIds', () => {
  it('returns an empty set when every filename is unique', () => {
    const docs = [
      makeDoc({ id: 'a', filename: 'one.pdf' }),
      makeDoc({ id: 'b', filename: 'two.pdf' }),
      makeDoc({ id: 'c', filename: 'three.pdf' }),
    ];
    expect(getDuplicateFilenameIds(docs)).toEqual(new Set());
  });

  it('flags both documents that share a filename', () => {
    const docs = [
      makeDoc({ id: 'a', filename: 'report.pdf' }),
      makeDoc({ id: 'b', filename: 'other.pdf' }),
      makeDoc({ id: 'c', filename: 'report.pdf' }),
    ];
    expect(getDuplicateFilenameIds(docs)).toEqual(new Set(['a', 'c']));
  });

  it('flags all documents in a group of 3+ sharing the same filename', () => {
    const docs = [
      makeDoc({ id: 'a', filename: 'dup.pdf' }),
      makeDoc({ id: 'b', filename: 'dup.pdf' }),
      makeDoc({ id: 'c', filename: 'dup.pdf' }),
    ];
    expect(getDuplicateFilenameIds(docs)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns an empty set for an empty list', () => {
    expect(getDuplicateFilenameIds([])).toEqual(new Set());
  });

  it('does not flag a single document with a unique filename', () => {
    expect(getDuplicateFilenameIds([makeDoc({ id: 'a' })])).toEqual(new Set());
  });
});
