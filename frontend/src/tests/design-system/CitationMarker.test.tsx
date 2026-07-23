/**
 * @file CitationMarker.test.tsx
 * @description Unit tests for the CitationMarker design-system component.
 *   Tests rendering, interactivity, accessibility, and state changes.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationMarker } from '../../design-system/components/CitationMarker';

const defaultProps = {
  index: 1,
  isActive: false,
  onEnter: vi.fn(),
  onLeave: vi.fn(),
  onClick: vi.fn(),
};

describe('CitationMarker', () => {
  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  it('renders with correct index label', () => {
    render(<CitationMarker {...defaultProps} index={3} />);
    expect(screen.getByTestId('citation-marker-3')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders with data-testid="citation-marker-{index}"', () => {
    render(<CitationMarker {...defaultProps} index={5} />);
    expect(screen.getByTestId('citation-marker-5')).toBeInTheDocument();
  });

  it('renders as superscript element', () => {
    render(<CitationMarker {...defaultProps} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker.tagName).toBe('SUP');
  });

  // --------------------------------------------------------------------------
  // Visual states
  // --------------------------------------------------------------------------

  it('isActive=false shows archive.green background (#2D5A4A)', () => {
    render(<CitationMarker {...defaultProps} isActive={false} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ background: '#2D5A4A' });
  });

  it('isActive=true shows stamp.red background (#FF4D2E)', () => {
    render(<CitationMarker {...defaultProps} isActive={true} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ background: '#FF4D2E' });
  });

  it('isActive=true applies scale(1.2) transform', () => {
    render(<CitationMarker {...defaultProps} isActive={true} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ transform: 'scale(1.2)' });
  });

  it('isActive=false applies scale(1) transform', () => {
    render(<CitationMarker {...defaultProps} isActive={false} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ transform: 'scale(1)' });
  });

  it('isActive=true applies box-shadow', () => {
    render(<CitationMarker {...defaultProps} isActive={true} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ boxShadow: '0 0 0 3px rgba(255,77,46,0.25)' });
  });

  it('isActive=false has no box-shadow', () => {
    render(<CitationMarker {...defaultProps} isActive={false} />);
    const marker = screen.getByTestId('citation-marker-1');
    expect(marker).toHaveStyle({ boxShadow: 'none' });
  });

  // --------------------------------------------------------------------------
  // Mouse events
  // --------------------------------------------------------------------------

  it('mouseenter calls onEnter with correct index', async () => {
    const onEnter = vi.fn();
    render(<CitationMarker {...defaultProps} onEnter={onEnter} index={2} />);
    const marker = screen.getByTestId('citation-marker-2');
    await userEvent.hover(marker);
    expect(onEnter).toHaveBeenCalledWith(2);
  });

  it('mouseleave calls onLeave', async () => {
    const onLeave = vi.fn();
    render(<CitationMarker {...defaultProps} onLeave={onLeave} />);
    const marker = screen.getByTestId('citation-marker-1');
    await userEvent.hover(marker);
    await userEvent.unhover(marker);
    expect(onLeave).toHaveBeenCalled();
  });

  it('click calls onClick with correct index', async () => {
    const onClick = vi.fn();
    render(<CitationMarker {...defaultProps} onClick={onClick} index={4} />);
    const marker = screen.getByTestId('citation-marker-4');
    await userEvent.click(marker);
    expect(onClick).toHaveBeenCalledWith(4);
  });

  // --------------------------------------------------------------------------
  // Keyboard events
  // --------------------------------------------------------------------------

  it('Enter key calls onClick', () => {
    const onClick = vi.fn();
    render(<CitationMarker {...defaultProps} onClick={onClick} index={1} />);
    const marker = screen.getByTestId('citation-marker-1');
    fireEvent.keyDown(marker, { key: 'Enter', code: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(1);
  });

  it('Space key calls onClick', () => {
    const onClick = vi.fn();
    render(<CitationMarker {...defaultProps} onClick={onClick} index={1} />);
    const marker = screen.getByTestId('citation-marker-1');
    fireEvent.keyDown(marker, { key: ' ', code: 'Space' });
    expect(onClick).toHaveBeenCalledWith(1);
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------

  it('has role="button" when not disabled', () => {
    render(<CitationMarker {...defaultProps} />);
    expect(screen.getByTestId('citation-marker-1')).toHaveAttribute('role', 'button');
  });

  it('has aria-label with citation number', () => {
    render(<CitationMarker {...defaultProps} index={3} />);
    expect(screen.getByTestId('citation-marker-3')).toHaveAttribute(
      'aria-label',
      'Citation 3 — click to jump to source',
    );
  });

  it('has tabIndex={0} for keyboard navigation', () => {
    render(<CitationMarker {...defaultProps} />);
    expect(screen.getByTestId('citation-marker-1')).toHaveAttribute('tabIndex', '0');
  });

  it('focus calls onEnter', () => {
    const onEnter = vi.fn();
    render(<CitationMarker {...defaultProps} onEnter={onEnter} />);
    const marker = screen.getByTestId('citation-marker-1');
    fireEvent.focus(marker);
    expect(onEnter).toHaveBeenCalledWith(1);
  });

  it('blur calls onLeave', () => {
    const onLeave = vi.fn();
    render(<CitationMarker {...defaultProps} onLeave={onLeave} />);
    const marker = screen.getByTestId('citation-marker-1');
    fireEvent.focus(marker);
    fireEvent.blur(marker);
    expect(onLeave).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Disabled state (streaming)
  // --------------------------------------------------------------------------

  it('disabled=true does not have role="button"', () => {
    render(<CitationMarker {...defaultProps} disabled={true} />);
    expect(screen.getByTestId('citation-marker-1')).not.toHaveAttribute('role', 'button');
  });

  it('disabled=true does not have tabIndex', () => {
    render(<CitationMarker {...defaultProps} disabled={true} />);
    expect(screen.getByTestId('citation-marker-1')).not.toHaveAttribute('tabIndex');
  });

  it('disabled=true does not call onEnter on mouseenter', async () => {
    const onEnter = vi.fn();
    render(<CitationMarker {...defaultProps} disabled={true} onEnter={onEnter} />);
    await userEvent.hover(screen.getByTestId('citation-marker-1'));
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('disabled=true does not call onClick on click', async () => {
    const onClick = vi.fn();
    render(<CitationMarker {...defaultProps} disabled={true} onClick={onClick} />);
    await userEvent.click(screen.getByTestId('citation-marker-1'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled=true shows archive.green background (same as inactive)', () => {
    render(<CitationMarker {...defaultProps} disabled={true} />);
    expect(screen.getByTestId('citation-marker-1')).toHaveStyle({ background: '#2D5A4A' });
  });

  // --------------------------------------------------------------------------
  // Tooltip
  // --------------------------------------------------------------------------

  it('renders "Jump to source" tooltip', () => {
    render(<CitationMarker {...defaultProps} />);
    expect(screen.getByText('Jump to source')).toBeInTheDocument();
  });

  it('tooltip is aria-hidden', () => {
    render(<CitationMarker {...defaultProps} />);
    const tooltip = screen.getByText('Jump to source');
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
  });
});
