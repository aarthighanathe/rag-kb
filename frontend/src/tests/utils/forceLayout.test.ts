/**
 * @file forceLayout.test.ts
 * @description Unit tests for force-directed layout utility functions
 * @author [Author Placeholder]
 * @created 2026-07-02
 */

import { describe, it, expect } from 'vitest';
import { runForceLayout, initCirclePositions, type LayoutNode, type LayoutEdge } from '@utils/forceLayout';

function makeNode(overrides: Partial<LayoutNode> = {}): LayoutNode {
  return {
    id: overrides.id ?? `doc-${Math.random().toString(36).slice(2, 8)}`,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    filename: overrides.filename ?? 'test.pdf',
    fileType: overrides.fileType ?? 'application/pdf',
    chunkCount: overrides.chunkCount ?? 5,
    status: overrides.status ?? 'ready',
    ...overrides,
  };
}

describe('runForceLayout', () => {
  it('returns empty array when given empty nodes', () => {
    const result = runForceLayout([], [], 800, 500);
    expect(result).toEqual([]);
  });

  it('returns nodes with stable positions (no NaN)', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })];
    const result = runForceLayout(nodes, [], 800, 500);
    for (const node of result) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('positions connected nodes closer together', () => {
    const nodes = [
      makeNode({ id: 'a', x: 100, y: 100 }),
      makeNode({ id: 'b', x: 700, y: 400 }),
    ];
    const edges: LayoutEdge[] = [{ source: 'a', target: 'b', similarity: 1.0 }];
    const result = runForceLayout(nodes, edges, 800, 500);
    const a = result.find((n) => n.id === 'a')!;
    const b = result.find((n) => n.id === 'b')!;
    const finalDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    // High similarity should attract them
    expect(finalDist).toBeLessThan(600);
  });

  it('positions disconnected nodes further apart via repulsion', () => {
    const nodes = [
      makeNode({ id: 'a', x: 400, y: 250 }),
      makeNode({ id: 'b', x: 410, y: 250 }),
    ];
    const result = runForceLayout(nodes, [], 800, 500);
    const a = result.find((n) => n.id === 'a')!;
    const b = result.find((n) => n.id === 'b')!;
    const finalDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    // Repulsion should push them apart
    expect(finalDist).toBeGreaterThan(30);
  });

  it('does not mutate the input array', () => {
    const nodes = [makeNode({ id: 'a', x: 400, y: 250 }), makeNode({ id: 'b', x: 200, y: 250 })];
    const originalX = nodes[0]!.x;
    runForceLayout(nodes, [], 800, 500);
    expect(nodes[0]!.x).toBe(originalX);
  });

  it('clamps node positions within bounds', () => {
    const nodes = [
      makeNode({ id: 'a', x: -100, y: -100 }),
      makeNode({ id: 'b', x: 900, y: 600 }),
    ];
    const result = runForceLayout(nodes, [], 800, 500);
    for (const node of result) {
      expect(node.x).toBeGreaterThanOrEqual(60);
      expect(node.x).toBeLessThanOrEqual(740);
      expect(node.y).toBeGreaterThanOrEqual(60);
      expect(node.y).toBeLessThanOrEqual(440);
    }
  });

  it('handles edge where source and target are missing from node list', () => {
    const nodes = [makeNode({ id: 'a' })];
    const edges: LayoutEdge[] = [{ source: 'a', target: 'nonexistent', similarity: 0.8 }];
    const result = runForceLayout(nodes, edges, 800, 500);
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0]!.x)).toBe(true);
  });
});

describe('initCirclePositions', () => {
  it('arranges nodes in a circle around the center', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' }), makeNode({ id: 'd' })];
    initCirclePositions(nodes, 800, 500);
    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // All should be at roughly the same distance from center
    const cx = 400;
    const cy = 250;
    const radii = nodes.map((n) => Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2));
    const avg = radii.reduce((a, b) => a + b, 0) / radii.length;
    for (const r of radii) {
      expect(Math.abs(r - avg)).toBeLessThan(5);
    }
  });

  it('handles single node', () => {
    const nodes = [makeNode({ id: 'a' })];
    initCirclePositions(nodes, 800, 500);
    expect(nodes[0]!.x).toBe(400 + 500 / 3);
    expect(nodes[0]!.y).toBe(250);
  });
});
