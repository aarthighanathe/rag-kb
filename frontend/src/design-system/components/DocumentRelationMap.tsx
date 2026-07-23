/**
 * @file DocumentRelationMap.tsx
 * @description Force-directed graph showing document similarity relationships.
 *   Pure SVG — no D3 dependency. Nodes represent documents, edges connect
 *   documents with average chunk cosine similarity above a threshold.
 * @author [Author Placeholder]
 * @created 2026-07-02
 */

import { useRef, useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import type { SimilarityPair, DocumentRecord } from '@services/api';
import {
  runForceLayout,
  initCirclePositions,
  type LayoutNode,
  type LayoutEdge,
} from '@utils/forceLayout';
import {
  RELATION_MAP,
  MAP_NODE,
  MAP_EDGE,
  MAP_DETAIL_PANEL,
  MAP_RECOMPUTE,
  STAT_TOTAL_DOCS,
} from '@tests/testIds';

// ─── Color palette ──────────────────────────────────────────────────────────
const STAMP_RED = '#FF4D2E';
const ARCHIVE_GREEN = '#2D5A4A';
const PAPER_BASE = '#F7F5F0';
const INK_BASE = '#1C1B19';
const INK_BORDER = '#2C2B29';
const INK_MUTED = '#8A8578';
const INK_HINT = '#B8B4AC';

// Edge strength thresholds
const EDGE_MIN_OPACITY = 0.15;
const EDGE_MAX_OPACITY = 1;
const EDGE_MIN_WIDTH = 1;
const EDGE_MAX_WIDTH = 5;
const NODE_RADIUS = 24;

// ─── Helpers ────────────────────────────────────────────────────────────────

function interpolateEdgeStyle(similarity: number): { opacity: number; strokeWidth: number } {
  const t = Math.max(0, Math.min(1, similarity));
  return {
    opacity: EDGE_MIN_OPACITY + t * (EDGE_MAX_OPACITY - EDGE_MIN_OPACITY),
    strokeWidth: EDGE_MIN_WIDTH + t * (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH),
  };
}

function fileTypeToColor(fileType: string): string {
  if (fileType === 'application/pdf') return STAMP_RED;
  if (fileType === 'text/markdown' || fileType === 'text/x-markdown') return ARCHIVE_GREEN;
  return INK_BASE;
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

function Tooltip({ node, position }: { node: LayoutNode; position: { x: number; y: number } }): ReactNode {
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x + NODE_RADIUS + 8,
        top: position.y - 12,
        background: INK_BASE,
        color: PAPER_BASE,
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "'Space Grotesk', sans-serif",
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ fontWeight: 600 }}>{node.filename}</div>
      <div style={{ opacity: 0.75 }}>
        {node.fileType.split('/').pop()?.toUpperCase()} — {node.chunkCount} chunks
      </div>
    </div>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend({ documents }: { documents: DocumentRecord[] }): ReactNode {
  const fileTypes = useMemo(() => {
    const types = new Set(documents.map((d) => d.mime_type));
    return Array.from(types).sort();
  }, [documents]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        padding: '8px 12px',
        background: PAPER_BASE,
        border: `1px solid ${INK_BORDER}`,
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "'Space Mono', monospace",
        color: INK_MUTED,
      }}
    >
      {fileTypes.map((ft) => (
        <div key={ft} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: fileTypeToColor(ft),
              display: 'inline-block',
            }}
          />
          {ft.split('/').pop()?.toUpperCase()}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export interface DocumentRelationMapProps {
  pairs: SimilarityPair[];
  documents: DocumentRecord[];
  onRecompute?: () => void;
  isComputing?: boolean;
  width?: number;
  height?: number;
}

/**
 * Renders a force-directed SVG graph of document similarity.
 * Nodes are documents; edges connect documents with avg chunk cosine similarity.
 */
export function DocumentRelationMap({
  pairs,
  documents,
  onRecompute,
  isComputing = false,
  width = 800,
  height = 500,
}: DocumentRelationMapProps): ReactNode {
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Check prefers-reduced-motion on mount
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Build layout graph from API data
  const { nodes, layoutEdges } = useMemo(() => {
    const nodeMap = new Map<string, LayoutNode>();
    for (const doc of documents) {
      nodeMap.set(doc.id, {
        id: doc.id,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        filename: doc.filename,
        fileType: doc.mime_type,
        chunkCount: doc.chunk_count,
        status: doc.status,
      });
    }

    // Only keep pairs where both documents exist
    const edges: LayoutEdge[] = pairs
      .filter((p) => nodeMap.has(p.documentA) && nodeMap.has(p.documentB))
      .map((p) => ({ source: p.documentA, target: p.documentB, similarity: p.similarity }));

    const nodeList = Array.from(nodeMap.values());
    initCirclePositions(nodeList, width, height);

    // Run force simulation (deterministic)
    const simulated = runForceLayout(nodeList, edges, width, height);

    return { nodes: simulated, layoutEdges: edges };
  }, [pairs, documents, width, height]);

  // Node click handler — select or deselect. Accepts both mouse and keyboard
  // activation (Enter/Space) since only `stopPropagation` is used, which both
  // React synthetic event types share via `SyntheticEvent`.
  const handleNodeClick = useCallback(
    (node: LayoutNode, event: React.SyntheticEvent) => {
      event.stopPropagation();
      if (selectedNode?.id === node.id) {
        setSelectedNode(null);
        setTooltipPos(null);
      } else {
        setSelectedNode(node);
      }
    },
    [selectedNode],
  );

  // Node hover — show tooltip
  const handleNodeEnter = useCallback((node: LayoutNode, event: React.MouseEvent) => {
    if (selectedNode) return; // skip tooltip when detail panel open
    setTooltipPos({ x: event.clientX, y: event.clientY });
    setSelectedNode(node);
  }, [selectedNode]);

  const handleNodeLeave = useCallback(() => {
    if (!selectedNode) return;
    // Only clear if not clicked (clicked = detail panel stays)
  }, [selectedNode]);

  // SVG click background — deselect
  const handleBgClick = useCallback(() => {
    setSelectedNode(null);
    setTooltipPos(null);
  }, []);

  // Detail panel data
  const selectedEdge = useMemo(() => {
    if (!selectedNode) return null;
    return layoutEdges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id,
    );
  }, [selectedNode, layoutEdges]);

  return (
    <div style={{ position: 'relative', fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* Stats bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          marginBottom: 8,
          background: PAPER_BASE,
          border: `1px solid ${INK_BORDER}`,
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <span data-testid={STAT_TOTAL_DOCS} style={{ fontFamily: "'Space Mono', monospace", color: INK_MUTED }}>
          {documents.length} documents — {pairs.length} relationships
        </span>
        {onRecompute && (
          <button
            data-testid={MAP_RECOMPUTE}
            onClick={onRecompute}
            disabled={isComputing}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontFamily: "'Space Mono', monospace",
              border: `1px solid ${INK_BORDER}`,
              borderRadius: 4,
              background: isComputing ? INK_HINT : PAPER_BASE,
              color: INK_BASE,
              cursor: isComputing ? 'not-allowed' : 'pointer',
            }}
          >
            {isComputing ? 'Computing…' : 'Recompute'}
          </button>
        )}
      </div>

      {/* Legend */}
      <Legend documents={documents} />

      {/* SVG graph */}
      <svg
        ref={svgRef}
        data-testid={RELATION_MAP}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: '100%',
          height: 'auto',
          background: PAPER_BASE,
          border: `1px solid ${INK_BORDER}`,
          borderRadius: 6,
          cursor: 'crosshair',
        }}
        onClick={handleBgClick}
      >
        {/* Edge layer */}
        <g>
          {layoutEdges.map((edge, i) => {
            const sourceNode = nodes.find((n) => n.id === edge.source);
            const targetNode = nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;
            const { opacity, strokeWidth } = interpolateEdgeStyle(edge.similarity);
            return (
              <line
                key={`e-${edge.source}-${edge.target}-${i}`}
                data-testid={MAP_EDGE}
                x1={sourceNode.x}
                y1={sourceNode.y}
                x2={targetNode.x}
                y2={targetNode.y}
                stroke={INK_BORDER}
                strokeWidth={strokeWidth}
                strokeOpacity={opacity}
                strokeLinecap="round"
                style={
                  reducedMotion
                    ? {}
                    : {
                        transition: 'stroke-opacity 0.3s ease',
                      }
                }
              />
            );
          })}
        </g>

        {/* Node layer */}
        <g>
          {nodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            return (
              <g
                key={node.id}
                data-testid={MAP_NODE}
                transform={`translate(${node.x}, ${node.y})`}
                style={{ cursor: 'pointer' }}
                tabIndex={0}
                role="button"
                aria-label={`${node.filename}, ${node.fileType.split('/').pop()?.toUpperCase()}, ${node.chunkCount} chunks${isSelected ? ', selected' : ''}`}
                aria-pressed={isSelected}
                onClick={(e) => handleNodeClick(node, e)}
                onMouseEnter={(e) => handleNodeEnter(node, e)}
                onMouseLeave={handleNodeLeave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNodeClick(node, e);
                  }
                }}
              >
                {/* Pulse ring for selected */}
                {isSelected && (
                  <circle
                    r={NODE_RADIUS + 6}
                    fill="none"
                    stroke={STAMP_RED}
                    strokeWidth={2}
                    strokeOpacity={0.4}
                    style={
                      reducedMotion
                        ? {}
                        : {
                            animation: 'pulse 1.5s ease-in-out infinite',
                          }
                    }
                  />
                )}
                {/* Node circle */}
                <circle
                  r={NODE_RADIUS}
                  fill={fileTypeToColor(node.fileType)}
                  stroke={isSelected ? STAMP_RED : INK_BORDER}
                  strokeWidth={isSelected ? 3 : 1.5}
                  style={
                    reducedMotion
                      ? {}
                      : {
                          transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
                        }
                  }
                />
                {/* File extension label */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={PAPER_BASE}
                  fontSize={10}
                  fontFamily="'Space Mono', monospace"
                  fontWeight={600}
                  pointerEvents="none"
                >
                  {node.fileType.split('/').pop()?.toUpperCase().slice(0, 3)}
                </text>
                {/* Filename label below */}
                <text
                  y={NODE_RADIUS + 14}
                  textAnchor="middle"
                  fill={INK_MUTED}
                  fontSize={10}
                  fontFamily="'Space Mono', monospace"
                  pointerEvents="none"
                >
                  {node.filename.length > 16 ? node.filename.slice(0, 14) + '…' : node.filename}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip (hover) */}
      {tooltipPos && selectedNode && !selectedEdge?.length && (
        <Tooltip node={selectedNode} position={tooltipPos} />
      )}

      {/* Detail panel (click) */}
      {selectedNode && selectedEdge && selectedEdge.length > 0 && (
        <div
          data-testid={MAP_DETAIL_PANEL}
          style={{
            position: 'absolute',
            right: 12,
            top: 60,
            width: 240,
            background: PAPER_BASE,
            border: `1px solid ${INK_BORDER}`,
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            fontSize: 12,
            fontFamily: "'Space Mono', monospace",
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: INK_BASE, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14 }}>
            {selectedNode.filename}
          </div>
          <div style={{ color: INK_MUTED, marginBottom: 8 }}>
            {selectedNode.fileType.split('/').pop()?.toUpperCase()} — {selectedNode.chunkCount} chunks
          </div>
          <div style={{ color: INK_MUTED, marginBottom: 4, fontWeight: 600 }}>
            Connected documents:
          </div>
          {selectedEdge.map((edge) => {
            const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
            const otherNode = nodes.find((n) => n.id === otherId);
            return (
              <div
                key={otherId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 0',
                  borderBottom: `1px solid ${INK_HINT}`,
                }}
              >
                <span style={{ color: INK_BASE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                  {otherNode?.filename ?? otherId}
                </span>
                <span
                  style={{
                    color: edge.similarity > 0.7 ? STAMP_RED : INK_MUTED,
                    fontWeight: 600,
                  }}
                >
                  {(edge.similarity * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
