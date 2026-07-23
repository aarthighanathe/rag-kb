/**
 * @file timeAgo.test.ts
 * @description Unit tests for relative time formatting utility
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo } from '../../utils/timeAgo';

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for very recent timestamps (<30s)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    expect(timeAgo('2026-07-01T11:59:55Z')).toBe('just now');
  });

  it('returns seconds for 30s–59s ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:45Z'));
    expect(timeAgo('2026-07-01T12:00:00Z')).toBe('45s');
  });

  it('returns minutes for 1m–59m ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:05:00Z'));
    expect(timeAgo('2026-07-01T12:00:00Z')).toBe('5m');
  });

  it('returns hours for 1h–23h ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
    expect(timeAgo('2026-07-01T12:00:00Z')).toBe('3h');
  });

  it('returns days for 1d–6d ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    expect(timeAgo('2026-07-01T12:00:00Z')).toBe('3d');
  });

  it('returns weeks for 7d+ ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(timeAgo('2026-07-01T12:00:00Z')).toBe('2w');
  });

  it('returns "just now" for future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    expect(timeAgo('2026-07-01T13:00:00Z')).toBe('just now');
  });

  it('returns empty string for invalid dates', () => {
    expect(timeAgo('not-a-date')).toBe('');
  });
});
