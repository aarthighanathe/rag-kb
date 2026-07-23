/**
 * @file estimateETA.test.ts
 * @description Tests for processing ETA estimation and formatting utilities.
 */

import { describe, it, expect } from 'vitest';
import { estimateProcessingSeconds, formatETA } from '../../utils/estimateETA';

// ---------------------------------------------------------------------------
// estimateProcessingSeconds
// ---------------------------------------------------------------------------

describe('estimateProcessingSeconds', () => {
  it('returns at least 5 seconds for tiny files (minimum clamp)', () => {
    const result = estimateProcessingSeconds(1, 'txt');
    expect(result).toBe(5);
  });

  it('returns larger value for larger files', () => {
    const small = estimateProcessingSeconds(10_000, 'txt');
    const large = estimateProcessingSeconds(5_000_000, 'txt');
    expect(large).toBeGreaterThan(small);
  });

  it('applies PDF multiplier (larger files to avoid clamp)', () => {
    const text = estimateProcessingSeconds(5_000_000, 'txt');
    const pdf = estimateProcessingSeconds(5_000_000, 'pdf');
    expect(pdf).toBeGreaterThan(text);
  });

  it('applies DOCX multiplier (larger files to avoid clamp)', () => {
    const text = estimateProcessingSeconds(5_000_000, 'txt');
    const docx = estimateProcessingSeconds(5_000_000, 'docx');
    expect(docx).toBeGreaterThan(text);
  });

  it('clamps minimum to 5 seconds', () => {
    const result = estimateProcessingSeconds(1, 'txt');
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(5);
  });

  it('clamps maximum to 120 seconds', () => {
    const result = estimateProcessingSeconds(100_000_000, 'txt');
    expect(result).toBeLessThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// formatETA
// ---------------------------------------------------------------------------

describe('formatETA', () => {
  it('formats minutes for >= 60 seconds', () => {
    expect(formatETA(65)).toBe('~1m');
    expect(formatETA(120)).toBe('~2m');
  });

  it('formats seconds for >= 10 seconds', () => {
    expect(formatETA(10)).toBe('~10s');
    expect(formatETA(45)).toBe('~45s');
  });

  it('formats "almost done" for < 10 seconds', () => {
    expect(formatETA(5)).toBe('almost done');
    expect(formatETA(9)).toBe('almost done');
  });
});
