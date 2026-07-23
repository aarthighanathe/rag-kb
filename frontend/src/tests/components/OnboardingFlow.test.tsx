/**
 * @file OnboardingFlow.test.tsx
 * @description Tests for the OnboardingFlow component shown on empty KB.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { OnboardingFlow } from '../../design-system/components/OnboardingFlow';
import { ONBOARDING_STEP, ONBOARDING_CTA } from '../testIds';

// ---------------------------------------------------------------------------
// Mock react-router-dom
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderComponent(): void {
  render(
    <BrowserRouter>
      <OnboardingFlow />
    </BrowserRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingFlow', () => {
  it('renders 3 step cards', () => {
    renderComponent();
    const steps = screen.getAllByTestId(ONBOARDING_STEP);
    expect(steps).toHaveLength(3);
  });

  it('shows step titles', () => {
    renderComponent();
    expect(screen.getByText('File it.')).toBeInTheDocument();
    expect(screen.getByText('Wait ~1 min.')).toBeInTheDocument();
    expect(screen.getByText('Ask anything.')).toBeInTheDocument();
  });

  it('renders CTA button', () => {
    renderComponent();
    expect(screen.getByTestId(ONBOARDING_CTA)).toBeInTheDocument();
  });

  it('navigates to /upload on CTA click', () => {
    renderComponent();
    fireEvent.click(screen.getByTestId(ONBOARDING_CTA));
    expect(mockNavigate).toHaveBeenCalledWith('/upload');
  });

  it('shows accepted file types hint', () => {
    renderComponent();
    expect(screen.getByText(/PDF · DOCX · TXT · MD/)).toBeInTheDocument();
  });

  it('shows heading about empty knowledge base', () => {
    renderComponent();
    expect(screen.getByText('Your knowledge base is empty.')).toBeInTheDocument();
  });
});
