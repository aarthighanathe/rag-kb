/**
 * @file sanitize.test.ts
 * @description Unit tests for the query-text sanitization defence-in-depth layer.
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { describe, it, expect } from 'vitest';
import { sanitizeQueryText } from '../../src/utils/sanitize.js';

describe('sanitizeQueryText', () => {
  it('strips simple HTML tags', () => {
    expect(sanitizeQueryText('<script>alert(1)</script>hello')).toBe('alert(1)hello');
  });

  it('strips nested and malformed tags', () => {
    expect(sanitizeQueryText('<div><b>bold</b</div>')).toBe('bold');
    expect(sanitizeQueryText('<a href="x">link<</a>')).toBe('link');
  });

  it('strips self-closing and attribute-laden tags', () => {
    expect(sanitizeQueryText('<img src=x onerror=alert(1)>text')).toBe('text');
    expect(sanitizeQueryText('before<br/>after')).toBe('beforeafter');
  });

  it('removes null bytes', () => {
    expect(sanitizeQueryText('hello\0world')).toBe('helloworld');
    expect(sanitizeQueryText('\0\0\0')).toBe('');
  });

  it('normalizes runs of whitespace to a single space', () => {
    expect(sanitizeQueryText('hello   \n\n  world\t\ttab')).toBe('hello world tab');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeQueryText('   padded query   ')).toBe('padded query');
  });

  it('truncates to the default max length of 2000', () => {
    const longText = 'a'.repeat(3000);
    const result = sanitizeQueryText(longText);
    expect(result).toHaveLength(2000);
  });

  it('truncates to a custom max length', () => {
    const result = sanitizeQueryText('abcdefghij', 5);
    expect(result).toBe('abcde');
  });

  it('reduces an HTML-tag-only query to an empty string', () => {
    expect(sanitizeQueryText('<div></div>')).toBe('');
    expect(sanitizeQueryText('<script></script>')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(sanitizeQueryText('What is the capital of France?')).toBe(
      'What is the capital of France?',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeQueryText('')).toBe('');
  });

  it('handles combined adversarial input (tags + null bytes + excess whitespace)', () => {
    const input = '  <script>\0alert(1)\0</script>   trailing   text  ';
    expect(sanitizeQueryText(input)).toBe('alert(1) trailing text');
  });
});
