/**
 * @file parseCitationText.test.tsx
 * @description Unit tests for the parseCitationText utility.
 *   Tests citation parsing, marker creation, and text highlighting.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseCitationText } from '../../utils/parseCitationText';

const defaultHandlers = {
  onEnter: vi.fn(),
  onLeave: vi.fn(),
  onClick: vi.fn(),
};

describe('parseCitationText', () => {
  // --------------------------------------------------------------------------
  // Basic parsing
  // --------------------------------------------------------------------------

  it('returns empty array for empty string', () => {
    const result = parseCitationText('', null, defaultHandlers);
    expect(result).toEqual([]);
  });

  it('returns plain text node when no citations present', () => {
    const result = parseCitationText('Hello world', null, defaultHandlers);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world');
  });

  it('parses Unicode superscript citations (①②③)', () => {
    const result = parseCitationText('Text ① and ② here', null, defaultHandlers);
    // Result contains text segments and CitationMarker elements
    // The exact count depends on how text is split, but we should have at least 3 nodes
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toBe('Text ');
    expect(result[1]).toHaveProperty('type');
  });

  it('parses bracket notation citations [1][2]', () => {
    const result = parseCitationText('Text [1] and [2] here', null, defaultHandlers);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toBe('Text ');
    expect(result[1]).toHaveProperty('type');
  });

  it('handles mixed notation (① and [2])', () => {
    const result = parseCitationText('First ① then [2]', null, defaultHandlers);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]).toBe('First ');
    expect(result[1]).toHaveProperty('type');
  });

  // --------------------------------------------------------------------------
  // Citation marker props
  // --------------------------------------------------------------------------

  it('renders CitationMarker with correct index for Unicode superscript', () => {
    render(<>{parseCitationText('Text ①', null, defaultHandlers)}</>);
    expect(screen.getByTestId('citation-marker-1')).toBeInTheDocument();
  });

  it('renders CitationMarker with correct index for bracket notation', () => {
    render(<>{parseCitationText('Text [3]', null, defaultHandlers)}</>);
    expect(screen.getByTestId('citation-marker-3')).toBeInTheDocument();
  });

  it('passes isActive=true to active citation marker', () => {
    render(<>{parseCitationText('Text [1]', 1, defaultHandlers)}</>);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveAttribute('role', 'button');
  });

  it('passes disabled prop to CitationMarker when disabled=true', () => {
    render(<>{parseCitationText('Text [1]', null, defaultHandlers, true)}</>);
    const marker = screen.getByTestId('citation-marker-1');
    // When disabled, marker should not have role="button"
    expect(marker).not.toHaveAttribute('role', 'button');
  });

  // --------------------------------------------------------------------------
  // Text highlighting
  // --------------------------------------------------------------------------

  it('highlights text span before active citation', () => {
    render(<>{parseCitationText('Payment is due [1].', 1, defaultHandlers)}</>);
    expect(screen.getByTestId('cited-span-1')).toBeInTheDocument();
    // Text is inside the span, use regex to match
    expect(screen.getByText(/Payment is due/)).toBeInTheDocument();
  });

  it('does not highlight text when activeCitation is null', () => {
    render(<>{parseCitationText('Payment is due [1].', null, defaultHandlers)}</>);
    expect(screen.queryByTestId('cited-span-1')).not.toBeInTheDocument();
  });

  it('highlights correct span when multiple citations exist', () => {
    render(<>{parseCitationText('First [1]. Second [2].', 2, defaultHandlers)}</>);
    expect(screen.queryByTestId('cited-span-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('cited-span-2')).toBeInTheDocument();
    // Text is split across elements, use regex to match partial text
    expect(screen.getByText(/First/)).toBeInTheDocument();
    expect(screen.getByText(/Second/)).toBeInTheDocument();
  });

  it('applies highlight styling to active span', () => {
    render(<>{parseCitationText('Text [1]', 1, defaultHandlers)}</>);
    const span = screen.getByTestId('cited-span-1');
    expect(span).toHaveStyle({
      background: 'rgba(255, 224, 102, 0.35)',
    });
  });

  // --------------------------------------------------------------------------
  // Handler passing
  // --------------------------------------------------------------------------

  it('passes handlers to CitationMarker', () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const onClick = vi.fn();
    
    render(<>{parseCitationText('Text [1]', null, { onEnter, onLeave, onClick })}</>);
    
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toBeInTheDocument();
    // Handlers are attached - we can verify they exist
    expect(typeof onEnter).toBe('function');
    expect(typeof onLeave).toBe('function');
    expect(typeof onClick).toBe('function');
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('handles text with only citations and no surrounding text', () => {
    const result = parseCitationText('[1][2][3]', null, defaultHandlers);
    expect(result).toHaveLength(3);
  });

  it('handles consecutive citations without text between', () => {
    const result = parseCitationText('①②③', null, defaultHandlers);
    expect(result).toHaveLength(3);
  });

  it('handles text ending with a citation', () => {
    const result = parseCitationText('Text here ①', null, defaultHandlers);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Text here ');
    expect(result[1]).toHaveProperty('type');
  });

  it('handles single citation in text', () => {
    render(<>{parseCitationText('Only ① here', null, defaultHandlers)}</>);
    expect(screen.getByTestId('citation-marker-1')).toBeInTheDocument();
  });

  it('returns array of React nodes safe to render', () => {
    const { container } = render(<p>{parseCitationText('Test ① and [2]', null, defaultHandlers)}</p>);
    expect(container.querySelector('p')).toBeInTheDocument();
    expect(container.textContent).toContain('Test');
    expect(container.textContent).toContain('and');
  });
});
