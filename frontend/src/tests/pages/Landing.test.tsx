/**
 * @file Landing.test.tsx
 * @description Tests for the Landing page — hero copy, CTA navigation, 3-step explainer,
 *   minimal header (logo only), and footer links.
 * @author [Author Placeholder]
 * @created 2026-06-20
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Landing } from '../../pages/Landing';

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Landing />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Header (minimal — logo only, no tab nav)
// ---------------------------------------------------------------------------

describe('Landing — minimal header', () => {
  it('renders a header with the logo link', () => {
    renderLanding();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /rag kb/i })).toBeInTheDocument();
  });

  it('does NOT render the AppHeader tab navigation', () => {
    renderLanding();
    // No Upload / Chat / Documents tabs
    expect(screen.queryByRole('tab', { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /documents/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Hero section
// ---------------------------------------------------------------------------

describe('Landing — hero', () => {
  it('renders the Fraunces display headline', () => {
    renderLanding();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent(/ask your/i);
    expect(heading).toHaveTextContent(/documents\./i);
  });

  it('includes "Get answers" and "with receipts" in the headline', () => {
    renderLanding();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/get answers/i);
    expect(heading).toHaveTextContent(/with receipts\./i);
  });

  it('renders a primary CTA button that navigates to /sign-in when signed out', () => {
    // The hero CTA is a <button> that calls navigate() programmatically, not
    // an <a href>/<Link> — and the default test mock (see tests/setup.ts) is
    // a signed-out visitor, so the target is /sign-in (LandingNav/HeroSection/
    // FooterCTA all resolve target = isSignedIn ? '/upload' : '/sign-in').
    renderLanding();
    const cta = screen.getByTestId('hero-cta-primary');
    expect(cta).toBeInTheDocument();
    expect(cta.tagName).toBe('BUTTON');
    expect(cta).toHaveAccessibleName(/start for free/i);
  });
});

// ---------------------------------------------------------------------------
// 3-step explainer (how-it-works)
// ---------------------------------------------------------------------------

describe('Landing — 3-step explainer', () => {
  it('renders the #how-it-works section', () => {
    renderLanding();
    const section = document.getElementById('how-it-works');
    expect(section).toBeInTheDocument();
  });

  it('renders "File it" step', () => {
    renderLanding();
    expect(screen.getByText(/file it/i)).toBeInTheDocument();
  });

  it('renders "Ask it" step', () => {
    renderLanding();
    expect(screen.getByText(/ask it/i)).toBeInTheDocument();
  });

  it('renders "Cite it" step', () => {
    renderLanding();
    expect(screen.getByText(/cite it/i)).toBeInTheDocument();
  });

  it('renders exactly 3 step panels', () => {
    renderLanding();
    const section = document.getElementById('how-it-works')!;
    // Each step card contains a step number badge and a title.
    // Use data-testid or just count the step numbers (01, 02, 03)
    const stepNumbers = within(section).getAllByText(/^0[123]$/);
    expect(stepNumbers).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe('Landing — footer', () => {
  it('renders a footer element', () => {
    renderLanding();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('footer contains a link to /upload', () => {
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    // Themed link text ("Acquisitions Desk"), not the literal word "upload" — assert by href.
    const link = within(footer).getByRole('link', { name: /acquisitions desk/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/upload');
  });

  it('footer contains a link to /chat', () => {
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    // Themed link text ("Reading Room"), not the literal word "chat" — assert by href.
    const link = within(footer).getByRole('link', { name: /reading room/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/chat');
  });
});
