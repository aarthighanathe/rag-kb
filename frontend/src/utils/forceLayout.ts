/**
 * @file forceLayout.ts
 * @description Simplified Fruchterman-Reingold force-directed layout for
 *   document relationship graphs. Pure JS — no D3 dependency.
 * @author [Author Placeholder]
 * @created 2026-07-02
 */

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  filename: string;
  fileType: string;
  chunkCount: number;
  status: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
  similarity: number;
}

// Force simulation constants
const ITERATIONS = 150;
const REPULSION = 8000;
const ATTRACTION = 0.1;
const DAMPING = 0.85;
const MIN_DIST = 30;

/**
 * Runs a simplified force-directed layout simulation.
 * Applies repulsion between all nodes and attraction along edges.
 * Runs for a fixed number of iterations (not continuous).
 * @param nodes - Initial node positions (will be mutated)
 * @param edges - Edges with similarity weights
 * @param width - SVG container width
 * @param height - SVG container height
 * @returns Nodes with stable positions
 */
export function runForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number,
): LayoutNode[] {
  if (nodes.length === 0) return [];

  // Work on a copy to avoid mutating the input
  const sim = nodes.map((n) => ({ ...n, vx: 0, vy: 0 }));

  // Build adjacency lookup for faster edge access
  const edgeMap = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
    if (!edgeMap.has(edge.target)) edgeMap.set(edge.target, []);
    edgeMap.get(edge.source)!.push(edge);
    edgeMap.get(edge.target)!.push(edge);
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion: every pair of nodes pushes apart
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const ni = sim[i];
        const nj = sim[j];
        if (!ni || !nj) continue;
        const dx = nj.x - ni.x;
        const dy = nj.y - ni.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
        const force = REPULSION / (dist * dist);
        ni.vx -= (dx / dist) * force;
        ni.vy -= (dy / dist) * force;
        nj.vx += (dx / dist) * force;
        nj.vy += (dy / dist) * force;
      }
    }

    // Attraction: connected nodes pull together
    // Weight by similarity: higher similarity = stronger pull
    for (const edge of edges) {
      const source = sim.find((n) => n.id === edge.source);
      const target = sim.find((n) => n.id === edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) continue;

      const force = ATTRACTION * dist * edge.similarity;
      source.vx += (dx / dist) * force;
      source.vy += (dy / dist) * force;
      target.vx -= (dx / dist) * force;
      target.vy -= (dy / dist) * force;
    }

    // Apply velocity + damping + bounds clamping
    for (const node of sim) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x = Math.max(60, Math.min(width - 60, node.x + node.vx));
      node.y = Math.max(60, Math.min(height - 60, node.y + node.vy));
    }
  }

  return sim;
}

/**
 * Initializes node positions in a circle for a good simulation starting point.
 * @param nodes - Nodes to initialize (mutates x, y)
 * @param width - SVG container width
 * @param height - SVG container height
 */
export function initCirclePositions(
  nodes: LayoutNode[],
  width: number,
  height: number,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    node.x = cx + radius * Math.cos((2 * Math.PI * i) / nodes.length);
    node.y = cy + radius * Math.sin((2 * Math.PI * i) / nodes.length);
  }
}
