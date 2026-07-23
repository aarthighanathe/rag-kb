/**
 * @file IndexCard.test.tsx
 * @description Unit tests for the IndexCard signature component.
 *   Covers: flip toggle, keyboard triggers, aria-pressed, deterministic rotation,
 *   and prefers-reduced-motion fallback.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IndexCard } from '../../design-system/components/IndexCard';

const BASE_PROPS = {
  chunkText: 'Attention is all you need.',
  documentName: 'paper.pdf',
  relevanceScore: 0.92,
  index: 1,
  chunkRef: 'p.3',
};

// Helper: restore matchMedia to undefined (default JSDOM state)
function resetMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: undefined,
  });
}

function mockMatchMedia(prefersReducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && prefersReducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('IndexCard', () => {
  beforeEach(() => {
    // Default: no reduced-motion preference
    mockMatchMedia(false);
  });

  afterEach(() => {
    resetMatchMedia();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  it('renders without crashing', () => {
    render(<IndexCard {...BASE_PROPS} />);
    expect(screen.getByTestId('index-card-1')).toBeInTheDocument();
  });

  it('renders front face initially', () => {
    render(<IndexCard {...BASE_PROPS} />);
    expect(screen.getByTestId('index-card-front')).toBeInTheDocument();
  });

  it('shows chunk text on the front', () => {
    render(<IndexCard {...BASE_PROPS} />);
    // In 3D mode both faces are in the DOM — scope to front face only
    const front = screen.getByTestId('index-card-front');
    expect(within(front).getByText('Attention is all you need.')).toBeInTheDocument();
  });

  it('shows document name on the front', () => {
    render(<IndexCard {...BASE_PROPS} />);
    // In 3D mode both faces are in the DOM — scope to front face only
    const front = screen.getByTestId('index-card-front');
    expect(within(front).getByText(/paper\.pdf/)).toBeInTheDocument();
  });

  it('renders paperclip only for index 0', () => {
    const { container: c0 } = render(<IndexCard {...BASE_PROPS} index={0} />);
    const { container: c1 } = render(<IndexCard {...BASE_PROPS} index={1} />);
    // The paperclip SVG is the only SVG in the root wrapper (stamp badge has no svg)
    const paperclips0 = c0.querySelectorAll('svg[aria-hidden="true"]');
    const paperclips1 = c1.querySelectorAll('svg[aria-hidden="true"]');
    expect(paperclips0.length).toBeGreaterThan(paperclips1.length);
  });

  // --------------------------------------------------------------------------
  // Flip — click
  // --------------------------------------------------------------------------

  it('aria-pressed is false initially on front button', () => {
    render(<IndexCard {...BASE_PROPS} />);
    expect(screen.getByTestId('index-card-front')).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips to show back on click', async () => {
    render(<IndexCard {...BASE_PROPS} />);
    await userEvent.click(screen.getByTestId('index-card-front'));
    // In 3D mode both faces are in DOM (CSS handles visibility). aria-pressed becomes true.
    expect(screen.getByTestId('index-card-front')).toHaveAttribute('aria-pressed', 'true');
  });

  it('aria-pressed becomes true after first click, false after second', async () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    await userEvent.click(front);
    expect(front).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(front);
    expect(front).toHaveAttribute('aria-pressed', 'false');
  });

  it('back button aria-pressed mirrors flip state', async () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    const back  = screen.getByTestId('index-card-back');
    expect(back).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(front);
    expect(back).toHaveAttribute('aria-pressed', 'true');
  });

  // --------------------------------------------------------------------------
  // Flip — keyboard: Enter
  // --------------------------------------------------------------------------

  it('flips on Enter key', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    front.focus();
    fireEvent.keyDown(front, { key: 'Enter', code: 'Enter' });
    expect(front).toHaveAttribute('aria-pressed', 'true');
  });

  it('unflips on second Enter key', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    front.focus();
    fireEvent.keyDown(front, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(front, { key: 'Enter', code: 'Enter' });
    expect(front).toHaveAttribute('aria-pressed', 'false');
  });

  // --------------------------------------------------------------------------
  // Flip — keyboard: Space
  // --------------------------------------------------------------------------

  it('flips on Space key', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    front.focus();
    fireEvent.keyDown(front, { key: ' ', code: 'Space' });
    expect(front).toHaveAttribute('aria-pressed', 'true');
  });

  it('unflips on second Space key', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const front = screen.getByTestId('index-card-front');
    front.focus();
    fireEvent.keyDown(front, { key: ' ', code: 'Space' });
    fireEvent.keyDown(front, { key: ' ', code: 'Space' });
    expect(front).toHaveAttribute('aria-pressed', 'false');
  });

  // --------------------------------------------------------------------------
  // Deterministic rotation
  // --------------------------------------------------------------------------

  it('applies a CSS rotation transform on the root', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const card = screen.getByTestId('index-card-1');
    const transform = card.style.transform;
    expect(transform).toMatch(/rotate\(-?\d+(\.\d+)?deg\)/);
  });

  it('rotation is identical across two renders with same seed', () => {
    const { getByTestId: g1, unmount: u1 } = render(<IndexCard {...BASE_PROPS} />);
    const rotation1 = g1('index-card-1').style.transform;
    u1();
    const { getByTestId: g2 } = render(<IndexCard {...BASE_PROPS} />);
    const rotation2 = g2('index-card-1').style.transform;
    expect(rotation1).toBe(rotation2);
  });

  it('rotation differs when documentName changes', () => {
    const { getByTestId: g1, unmount: u1 } = render(<IndexCard {...BASE_PROPS} documentName="alpha.pdf" />);
    const r1 = g1('index-card-1').style.transform;
    u1();
    const { getByTestId: g2 } = render(<IndexCard {...BASE_PROPS} documentName="beta.pdf" />);
    const r2 = g2('index-card-1').style.transform;
    expect(r1).not.toBe(r2);
  });

  it('rotation differs when index changes', () => {
    const { getByTestId: g1, unmount: u1 } = render(<IndexCard {...BASE_PROPS} index={0} />);
    const r1 = g1('index-card-0').style.transform;
    u1();
    const { getByTestId: g2 } = render(<IndexCard {...BASE_PROPS} index={3} />);
    const r2 = g2('index-card-3').style.transform;
    expect(r1).not.toBe(r2);
  });

  it('rotation value is within -1.5deg to +1.5deg range', () => {
    render(<IndexCard {...BASE_PROPS} />);
    const transform = screen.getByTestId('index-card-1').style.transform;
    const match = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
    expect(match).not.toBeNull();
    const degStr = match?.[1];
    expect(degStr).toBeDefined();
    const deg = parseFloat(degStr as string);
    expect(deg).toBeGreaterThanOrEqual(-1.5);
    expect(deg).toBeLessThanOrEqual(1.5);
  });

  // --------------------------------------------------------------------------
  // Reduced-motion
  // --------------------------------------------------------------------------

  it('reduced-motion: renders a single button (not card-flipper), no 3D wrapper class', () => {
    mockMatchMedia(true);
    const { container } = render(<IndexCard {...BASE_PROPS} />);
    // In reduced-motion mode, there is no div.card-scene or div.card-flipper
    expect(container.querySelector('.card-scene')).toBeNull();
    expect(container.querySelector('.card-flipper')).toBeNull();
  });

  it('reduced-motion: front content visible initially', () => {
    mockMatchMedia(true);
    render(<IndexCard {...BASE_PROPS} />);
    expect(screen.getByTestId('index-card-front')).toBeInTheDocument();
  });

  it('reduced-motion: click swaps to back content without 3D classes', () => {
    mockMatchMedia(true);
    render(<IndexCard {...BASE_PROPS} />);
    // In reduced-motion mode, the single button toggles via conditional render
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(screen.getByTestId('index-card-back')).toBeInTheDocument();
    // Front should no longer be rendered
    expect(screen.queryByTestId('index-card-front')).not.toBeInTheDocument();
  });

  it('reduced-motion: click again swaps back to front', () => {
    mockMatchMedia(true);
    render(<IndexCard {...BASE_PROPS} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('index-card-front')).toBeInTheDocument();
    expect(screen.queryByTestId('index-card-back')).not.toBeInTheDocument();
  });

  it('reduced-motion: aria-pressed still reflects flip state', () => {
    mockMatchMedia(true);
    render(<IndexCard {...BASE_PROPS} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  // --------------------------------------------------------------------------
  // Citation highlighting
  // --------------------------------------------------------------------------

  describe('citation highlighting', () => {
    it('isActive=false shows default border and shadow', () => {
      render(<IndexCard {...BASE_PROPS} citationIndex={1} isActive={false} />);
      const card = screen.getByTestId('index-card-1');
      // Check that the card has the default border style (browser converts hex to rgb)
      expect(card.style.border).toMatch(/1px solid/);
      expect(card.style.border).toContain('216, 212, 200');
    });

    it('isActive=true shows archive.green border', () => {
      render(<IndexCard {...BASE_PROPS} citationIndex={1} isActive={true} />);
      const card = screen.getByTestId('index-card-1');
      // Check that the card has the active border style (browser converts hex to rgb)
      expect(card.style.border).toMatch(/2px solid/);
      expect(card.style.border).toContain('45, 90, 74');
    });

    it('isActive=true applies lift transform', () => {
      render(<IndexCard {...BASE_PROPS} citationIndex={1} isActive={true} />);
      const card = screen.getByTestId('index-card-1');
      const transform = card.style.transform;
      expect(transform).toContain('translateY(-4px)');
    });

    it('mouseenter calls onEnter with citationIndex', async () => {
      const onEnter = vi.fn();
      render(
        <IndexCard
          {...BASE_PROPS}
          citationIndex={2}
          onEnter={onEnter}
        />,
      );
      const card = screen.getByTestId('index-card-2');
      await userEvent.hover(card);
      expect(onEnter).toHaveBeenCalledWith(2);
    });

    it('mouseleave calls onLeave', async () => {
      const onLeave = vi.fn();
      render(
        <IndexCard
          {...BASE_PROPS}
          citationIndex={1}
          onLeave={onLeave}
        />,
      );
      const card = screen.getByTestId('index-card-1');
      await userEvent.hover(card);
      await userEvent.unhover(card);
      expect(onLeave).toHaveBeenCalled();
    });

    it('cardRef callback called with DOM element on mount', () => {
      const cardRef = vi.fn();
      render(
        <IndexCard
          {...BASE_PROPS}
          citationIndex={1}
          cardRef={cardRef}
        />,
      );
      expect(cardRef).toHaveBeenCalledWith(expect.any(HTMLElement));
    });

    it('relevance stamp: isActive=false shows stamp.red for high scores', () => {
      render(
        <IndexCard
          {...BASE_PROPS}
          relevanceScore={0.94}
          citationIndex={1}
          isActive={false}
        />,
      );
      const stamp = screen.getByText('94%');
      expect(stamp).toHaveClass('bg-ds-stamp');
    });

    it('relevance stamp: isActive=true shows archive.green', () => {
      render(
        <IndexCard
          {...BASE_PROPS}
          relevanceScore={0.94}
          citationIndex={1}
          isActive={true}
        />,
      );
      const stamp = screen.getByText('94%');
      expect(stamp).toHaveClass('bg-ds-archive');
    });

    it('uses citationIndex for data-testid when provided', () => {
      render(<IndexCard {...BASE_PROPS} citationIndex={5} />);
      expect(screen.getByTestId('index-card-5')).toBeInTheDocument();
    });

    it('falls back to index for data-testid when citationIndex not provided', () => {
      render(<IndexCard {...BASE_PROPS} index={3} />);
      expect(screen.getByTestId('index-card-3')).toBeInTheDocument();
    });
  });
});
