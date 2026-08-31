/**
 * @file SignIn.test.tsx
 * @description Tests for the SignIn page — renders Clerk's SignIn component (mocked
 *   globally in tests/setup.ts) with the Lumina branding header, and doesn't crash.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignInPage } from '../../pages/SignIn';

function renderSignIn(): ReturnType<typeof render> {
  return render(<SignInPage />);
}

describe('SignInPage', () => {
  it('renders without crashing', () => {
    expect(() => renderSignIn()).not.toThrow();
  });

  it('renders the mocked Clerk SignIn component', () => {
    renderSignIn();
    expect(screen.getByTestId('mock-sign-in')).toBeInTheDocument();
  });

  it('renders the Lumina branding', () => {
    renderSignIn();
    expect(screen.getByText('Lumina')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    renderSignIn();
    expect(screen.getByText('YOUR PRIVATE KNOWLEDGE BASE')).toBeInTheDocument();
  });

  it('renders the privacy footnote', () => {
    renderSignIn();
    expect(screen.getByText('Your knowledge base is private to your account.')).toBeInTheDocument();
  });
});
