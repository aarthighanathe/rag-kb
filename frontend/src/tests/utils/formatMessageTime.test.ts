/**
 * @file formatMessageTime.test.ts
 * @description Unit tests for the shared chat-message time formatter
 *   (previously duplicated identically in AssistantMessage and ChatMessage).
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect } from 'vitest';
import { formatMessageTime } from '../../utils/formatMessageTime';

describe('formatMessageTime', () => {
  it('returns an empty string when iso is undefined', () => {
    expect(formatMessageTime(undefined)).toBe('');
  });

  it('does not throw for an invalid date string (returns "Invalid Date", matching Date/toLocaleTimeString\'s own behavior)', () => {
    // new Date('not-a-date') doesn't throw — it produces an Invalid Date
    // object, and toLocaleTimeString() on it returns the literal string
    // "Invalid Date" rather than throwing, so the try/catch here only ever
    // guards a genuinely unparseable non-string input reaching this far.
    expect(() => formatMessageTime('not-a-date')).not.toThrow();
    expect(formatMessageTime('not-a-date')).toBe('Invalid Date');
  });

  it('formats a valid ISO timestamp as a localized HH:MM string', () => {
    const result = formatMessageTime('2026-06-16T15:45:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Locale-formatted, so assert shape rather than an exact string.
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});
