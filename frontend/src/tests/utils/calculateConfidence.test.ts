/**
 * @file calculateConfidence.test.ts
 * @description Unit tests for calculateConfidence utility
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../../utils/calculateConfidence';

describe('calculateConfidence', () => {
  it('returns very-low for empty array', () => {
    const result = calculateConfidence([]);
    expect(result.level).toBe('very-low');
    expect(result.label).toBe('No sources');
    expect(result.warning).toBe('No sources were retrieved for this answer.');
    expect(result.average).toBe(0);
  });

  it('returns high confidence when average >= 0.25', () => {
    const result = calculateConfidence([0.30, 0.35, 0.28]);
    expect(result.level).toBe('high');
    expect(result.label).toBe('High confidence');
    expect(result.warning).toBeNull();
    expect(result.average).toBeCloseTo(0.31, 2);
  });

  it('returns medium confidence when average >= 0.12', () => {
    const result = calculateConfidence([0.15, 0.18, 0.11]);
    expect(result.level).toBe('medium');
    expect(result.label).toBe('Moderate confidence');
    expect(result.warning).toBeNull();
  });

  it('returns low confidence when average >= 0.04', () => {
    const result = calculateConfidence([0.05, 0.10, 0.02]);
    expect(result.level).toBe('low');
    expect(result.label).toBe('Low confidence');
    expect(result.warning).toBe('The AI found some content but the match to your question is weak. Try rephrasing or asking something more specific.');
  });

  it('returns very-low confidence when average < 0.04', () => {
    const result = calculateConfidence([-0.1, -0.05, -0.02]);
    expect(result.level).toBe('very-low');
    expect(result.label).toBe('Very low confidence');
    expect(result.warning).toBe('The AI could not find a strong match in your documents. Try rephrasing your question or check that the right documents are selected.');
  });

  it('handles single citation', () => {
    const result = calculateConfidence([0.5]);
    expect(result.level).toBe('high');
    expect(result.average).toBe(0.5);
  });

  it('handles mixed positive and negative scores', () => {
    const result = calculateConfidence([0.6, -0.2, 0.1]);
    // Average = (0.6 + (-0.2) + 0.1) / 3 = 0.5 / 3 ≈ 0.167 — above the 0.12 medium floor
    expect(result.level).toBe('medium');
    expect(result.average).toBeCloseTo(0.167, 2);
  });

  it('correctly identifies boundary at 0.25 (high)', () => {
    const result = calculateConfidence([0.25]);
    expect(result.level).toBe('high');
  });

  it('correctly identifies boundary at 0.12 (medium)', () => {
    const result = calculateConfidence([0.12]);
    expect(result.level).toBe('medium');
  });

  it('correctly identifies boundary at 0.04 (low)', () => {
    const result = calculateConfidence([0.04]);
    expect(result.level).toBe('low');
  });

  it('correctly identifies boundary just below 0.04 (very-low)', () => {
    const result = calculateConfidence([0.0]);
    expect(result.level).toBe('very-low');
  });
});
