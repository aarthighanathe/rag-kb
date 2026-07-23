/**
 * @file DocumentRelationMap.test.tsx
 * @description Unit tests for the DocumentRelationMap component
 * @author [Author Placeholder]
 * @created 2026-07-02
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DocumentRelationMap } from '../../design-system/components/DocumentRelationMap';
import type { SimilarityPair, DocumentRecord } from '../../services/api';
import {
  RELATION_MAP,
  MAP_NODE,
  MAP_EDGE,
  MAP_DETAIL_PANEL,
  MAP_RECOMPUTE,
  STAT_TOTAL_DOCS,
} from '../../tests/testIds';

const MOCK_DOCS: DocumentRecord[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    filename: 'report.pdf',
    mime_type: 'application/pdf',
    size_bytes: 204800,
    status: 'ready',
    chunk_count: 12,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:01:30.000Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    filename: 'notes.md',
    mime_type: 'text/markdown',
    size_bytes: 1024,
    status: 'ready',
    chunk_count: 3,
    created_at: '2026-06-17T10:00:00.000Z',
    updated_at: '2026-06-17T10:01:00.000Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    filename: 'data.csv',
    mime_type: 'text/csv',
    size_bytes: 4096,
    status: 'ready',
    chunk_count: 5,
    created_at: '2026-06-18T10:00:00.000Z',
    updated_at: '2026-06-18T10:01:00.000Z',
  },
];

const MOCK_PAIRS: SimilarityPair[] = [
  { documentA: MOCK_DOCS[0]!.id, documentB: MOCK_DOCS[1]!.id, similarity: 0.85 },
  { documentA: MOCK_DOCS[0]!.id, documentB: MOCK_DOCS[2]!.id, similarity: 0.42 },
];

function renderMap(overrides: Partial<React.ComponentProps<typeof DocumentRelationMap>> = {}) {
  return render(
    <DocumentRelationMap
      pairs={MOCK_PAIRS}
      documents={MOCK_DOCS}
      width={800}
      height={500}
      {...overrides}
    />,
  );
}

describe('DocumentRelationMap', () => {
  beforeEach(() => {
    // Mock matchMedia for prefers-reduced-motion
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the SVG relation map', () => {
    renderMap();
    expect(screen.getByTestId(RELATION_MAP)).toBeInTheDocument();
  });

  it('renders nodes for each document', () => {
    renderMap();
    const nodes = screen.getAllByTestId(MAP_NODE);
    expect(nodes).toHaveLength(MOCK_DOCS.length);
  });

  it('renders edges for each pair', () => {
    renderMap();
    const edges = screen.getAllByTestId(MAP_EDGE);
    expect(edges).toHaveLength(MOCK_PAIRS.length);
  });

  it('shows total docs count in stats bar', () => {
    renderMap();
    const stats = screen.getByTestId(STAT_TOTAL_DOCS);
    expect(stats).toHaveTextContent(`${MOCK_DOCS.length} documents`);
    expect(stats).toHaveTextContent(`${MOCK_PAIRS.length} relationships`);
  });

  it('shows detail panel when a node is clicked', () => {
    renderMap();
    const nodes = screen.getAllByTestId(MAP_NODE);
    fireEvent.click(nodes[0]!);
    expect(screen.getByTestId(MAP_DETAIL_PANEL)).toBeInTheDocument();
  });

  it('displays connected documents in detail panel', () => {
    renderMap();
    const nodes = screen.getAllByTestId(MAP_NODE);
    fireEvent.click(nodes[0]!); // Click first doc (report.pdf)
    const panel = screen.getByTestId(MAP_DETAIL_PANEL);
    expect(panel).toHaveTextContent('report.pdf');
    expect(panel).toHaveTextContent('notes.md');
    expect(panel).toHaveTextContent('85.0%');
  });

  it('hides detail panel on second click (toggle)', () => {
    renderMap();
    const nodes = screen.getAllByTestId(MAP_NODE);
    fireEvent.click(nodes[0]!);
    expect(screen.getByTestId(MAP_DETAIL_PANEL)).toBeInTheDocument();
    fireEvent.click(nodes[0]!);
    expect(screen.queryByTestId(MAP_DETAIL_PANEL)).not.toBeInTheDocument();
  });

  it('calls onRecompute when recompute button is clicked', () => {
    const onRecompute = vi.fn();
    renderMap({ onRecompute });
    fireEvent.click(screen.getByTestId(MAP_RECOMPUTE));
    expect(onRecompute).toHaveBeenCalledTimes(1);
  });

  it('disables recompute button when isComputing is true', () => {
    renderMap({ isComputing: true, onRecompute: vi.fn() });
    const btn = screen.getByTestId(MAP_RECOMPUTE);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Computing…');
  });

  it('shows SVG with correct viewBox', () => {
    renderMap({ width: 1000, height: 600 });
    const svg = screen.getByTestId(RELATION_MAP);
    expect(svg).toHaveAttribute('viewBox', '0 0 1000 600');
  });

  it('does not render edges when pairs is empty', () => {
    renderMap({ pairs: [] });
    expect(screen.getAllByTestId(MAP_NODE)).toHaveLength(MOCK_DOCS.length);
    expect(screen.queryByTestId(MAP_EDGE)).not.toBeInTheDocument();
  });
});
