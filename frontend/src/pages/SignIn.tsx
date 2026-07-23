/**
 * @file SignIn.tsx
 * @description Clerk-powered sign-in page with Google OAuth only.
 *   Styled to match the Ink-and-Paper design system used by Landing.tsx.
 * @created 2026-07-05
 */

import React from 'react';
import { SignIn } from '@clerk/clerk-react';
import { BookOpen } from 'lucide-react';
import { ink, paper, stamp, fontFamily } from '../design-system/tokens';

export function SignInPage(): React.JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: paper.base,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '6px',
          }}
        >
          <BookOpen size={22} aria-hidden="true" style={{ color: ink.base }} />
          <span
            style={{
              fontFamily: fontFamily.display,
              fontWeight: 900,
              fontSize: '28px',
              color: ink.base,
            }}
          >
            RAG KB
          </span>
        </div>
        <div
          style={{
            fontFamily: fontFamily.mono,
            fontSize: '11px',
            letterSpacing: '0.1em',
            color: ink.muted,
          }}
        >
          YOUR PRIVATE KNOWLEDGE BASE
        </div>
      </div>

      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-in"
        forceRedirectUrl="/upload"
        appearance={{
          variables: {
            colorPrimary: stamp.red,
            colorBackground: '#FFFFFF',
            colorText: ink.base,
            colorTextSecondary: ink.secondary,
            colorInputBackground: '#FFFFFF',
            colorInputText: ink.base,
            borderRadius: '2px',
            fontFamily: fontFamily.body,
          },
          elements: {
            card: {
              border: `1px solid ${paper.border}`,
              boxShadow: '0 2px 8px rgba(28,27,25,0.06)',
            },
            headerTitle: {
              fontFamily: fontFamily.display,
              fontWeight: 900,
            },
            socialButtonsBlockButton: {
              border: `1.5px solid ${ink.base}`,
              borderRadius: '2px',
              fontFamily: fontFamily.body,
              fontWeight: 600,
            },
            formButtonPrimary: {
              backgroundColor: stamp.red,
              borderRadius: '2px',
              fontFamily: fontFamily.body,
              fontWeight: 700,
            },
          },
        }}
      />

      <div
        style={{
          marginTop: '24px',
          fontFamily: fontFamily.mono,
          fontSize: '11px',
          color: ink.muted,
          textAlign: 'center',
        }}
      >
        Your knowledge base is private to your account.
      </div>
    </div>
  );
}
