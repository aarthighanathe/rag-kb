/**
 * @file formatError.test.ts
 * @description Unit tests for user-facing error message formatting.
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

import { describe, it, expect } from 'vitest';
import { formatUserFacingError } from '../../utils/formatError';

describe('formatUserFacingError', () => {
  it('maps DB_CONNECTIVITY code to a setup hint regardless of message text', () => {
    const result = formatUserFacingError(
      'Failed to list documents: TypeError: fetch failed',
      'DB_CONNECTIVITY',
    );
    expect(result).toMatch(/database service is unavailable/i);
    expect(result).not.toContain('[object Object]');
    expect(result).not.toContain('TypeError');
  });

  it('maps DB_CONNECTIVITY code to a setup hint for any originating operation', () => {
    const result = formatUserFacingError(
      'Failed to create document: TypeError: fetch failed',
      'DB_CONNECTIVITY',
    );
    expect(result).toMatch(/database service is unavailable/i);
  });

  it('passes through DB_SCHEMA_NOT_MIGRATED messages unchanged (already user-facing)', () => {
    const msg = 'Database schema is not set up. Run `cd backend && npm run db:migrate`, then restart the backend.';
    expect(formatUserFacingError(msg, 'DB_SCHEMA_NOT_MIGRATED')).toBe(msg);
  });

  it('maps generic network errors (no code) to a server hint', () => {
    const result = formatUserFacingError('Network error during upload');
    expect(result).toMatch(/could not reach the server/i);
  });

  it('maps the browser fetch TypeError message to a server hint', () => {
    // Chrome/Edge throw `TypeError: Failed to fetch` when the backend is unreachable —
    // note the word order differs from Node's `fetch failed`. No server response
    // means no code is available for this case.
    const result = formatUserFacingError('Failed to fetch');
    expect(result).toMatch(/could not reach the server/i);
  });

  it('maps Firefox and Safari fetch failure messages to a server hint', () => {
    expect(formatUserFacingError('NetworkError when attempting to fetch resource.'))
      .toMatch(/could not reach the server/i);
    expect(formatUserFacingError('Load failed')).toMatch(/could not reach the server/i);
  });

  it('passes through validation and business errors unchanged when no DB code is present', () => {
    const msg = 'File content does not match the declared extension ".pdf"';
    expect(formatUserFacingError(msg)).toBe(msg);
  });

  it('passes through a generic DB_GENERIC-coded message unchanged (context already embedded server-side)', () => {
    const msg = 'Failed to list documents: duplicate key value';
    expect(formatUserFacingError(msg, 'DB_GENERIC')).toBe(msg);
  });
});
