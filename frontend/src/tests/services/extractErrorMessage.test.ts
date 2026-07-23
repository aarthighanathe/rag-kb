/**
 * @file extractErrorMessage.test.ts
 * @description Unit tests for extractErrorMessage's server-vs-internal error boundary —
 *   a server-produced TypedApiError (or a recognized network-unreachable failure) shows
 *   its real message; any other caught value falls back to a generic message rather than
 *   leaking internal exception text to the user.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect } from 'vitest';
import { extractErrorMessage, TypedApiError } from '../../services/api';

describe('extractErrorMessage', () => {
  it('shows the real message for a server-produced TypedApiError', () => {
    const err = new TypedApiError('File content does not match the declared extension ".pdf"', {
      correlationId: 'corr-1',
      statusCode: 422,
    });
    expect(extractErrorMessage(err)).toBe(
      'File content does not match the declared extension ".pdf"',
    );
  });

  it('applies DB error code formatting to a TypedApiError', () => {
    const err = new TypedApiError('Failed to list documents: TypeError: fetch failed', {
      correlationId: 'corr-2',
      statusCode: 500,
      code: 'DB_CONNECTIVITY',
    });
    expect(extractErrorMessage(err)).toMatch(/database service is unavailable/i);
  });

  it('shows a server hint when the browser fetch itself failed (backend unreachable)', () => {
    const err = new TypeError('Failed to fetch');
    expect(extractErrorMessage(err)).toMatch(/could not reach the server/i);
  });

  it('shows a server hint for Node/undici-style fetch failures', () => {
    const err = new Error('TypeError: fetch failed');
    expect(extractErrorMessage(err)).toMatch(/could not reach the server/i);
  });

  it('falls back to the generic message for a plain client-side Error', () => {
    const err = new Error('Cannot read properties of undefined (reading \'foo\')');
    expect(extractErrorMessage(err, 'Upload failed')).toBe('Upload failed');
  });

  it('falls back to the generic message for a thrown string', () => {
    expect(extractErrorMessage('some internal string', 'Upload failed')).toBe('Upload failed');
  });

  it('falls back to the generic message for a thrown plain object', () => {
    expect(extractErrorMessage({ message: 'looks like an error but is not' }, 'Upload failed')).toBe(
      'Upload failed',
    );
  });

  it('falls back to the generic message for a thrown API-envelope-shaped object that never went through fetch', () => {
    expect(
      extractErrorMessage({ error: { message: 'spoofed', code: 'X' } }, 'Upload failed'),
    ).toBe('Upload failed');
  });

  it('falls back to the default fallback message when none is provided', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('Upload failed — unknown error');
  });

  it('falls back to the generic message for null/undefined', () => {
    expect(extractErrorMessage(null, 'Upload failed')).toBe('Upload failed');
    expect(extractErrorMessage(undefined, 'Upload failed')).toBe('Upload failed');
  });
});
