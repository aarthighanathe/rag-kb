/**
 * @file OnboardingFlow.tsx
 * @description Inline onboarding walkthrough shown on Chat page
 *   when no documents have been uploaded. Guides user through 3 steps.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../../hooks/useMobileBreakpoint';
import { Upload, Cog, MessageCircle } from 'lucide-react';
import { ONBOARDING_STEP, ONBOARDING_CTA } from '../../tests/testIds';

// ---------------------------------------------------------------------------
// Step data
// ---------------------------------------------------------------------------

const STEPS = [
  {
    num: '01',
    title: 'File it.',
    description: 'Drop any PDF, Word doc, Markdown, or text file into the Upload page.',
    Icon: Upload,
  },
  {
    num: '02',
    title: 'Wait ~1 min.',
    description: 'We chunk it, embed it, and index it automatically. No configuration needed.',
    Icon: Cog,
    pulse: true,
  },
  {
    num: '03',
    title: 'Ask anything.',
    description: 'Come back here and ask questions in plain language. Every answer cites its source.',
    Icon: MessageCircle,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * 3-step onboarding flow for empty knowledge base.
 */
export function OnboardingFlow(): React.JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile(768);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '24px 16px' : '32px 24px',
        textAlign: 'center',
        minHeight: 0,
      }}
    >
      <div style={{ marginBottom: isMobile ? '16px' : '24px' }}>
        <h2
          className="font-display"
          style={{
            fontSize: isMobile ? '16px' : '20px',
            fontWeight: 900,
            fontStyle: 'italic',
            color: '#1C1B19',
            marginBottom: '6px',
          }}
        >
          Your knowledge base is empty.
        </h2>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: isMobile ? '12px' : '14px', color: '#8A8578' }}>
          Let's file your first document.
        </p>
      </div>

      {/* Step cards */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? '12px' : '16px',
          marginBottom: isMobile ? '20px' : '28px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          width: isMobile ? '100%' : 'auto',
          maxWidth: isMobile ? '320px' : 'none',
        }}
      >
        {STEPS.map((step, i) => (
          <div
            key={step.num}
            data-testid={ONBOARDING_STEP}
            style={{
              width: isMobile ? '100%' : '180px',
              background: '#FFFFFF',
              border: '1px solid #D8D4C8',
              padding: isMobile ? '16px 12px' : '20px 16px',
              position: 'relative',
              transform: `rotate(${i % 2 === 0 ? -1 : 1}deg)`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            {/* Step number badge */}
            <span
              style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                background: '#FF4D2E',
                color: '#FFFFFF',
                fontFamily: "'Space Mono', monospace",
                fontSize: '9px',
                fontWeight: 700,
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {step.num}
            </span>

            <step.Icon
              size={isMobile ? 18 : 20}
              style={{
                color: '#FF4D2E',
                marginBottom: '8px',
                animation: step.pulse ? 'pulse 2s ease-in-out infinite' : undefined,
              }}
              aria-hidden="true"
            />

            <h3
              className="font-display"
              style={{
                fontSize: isMobile ? '12px' : '14px',
                fontWeight: 900,
                fontStyle: 'italic',
                color: '#1C1B19',
                marginBottom: '4px',
              }}
            >
              {step.title}
            </h3>
            <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: isMobile ? '10px' : '12px', color: '#5C5850', lineHeight: 1.4 }}>
              {step.description}
            </p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        type="button"
        data-testid={ONBOARDING_CTA}
        onClick={() => navigate('/upload')}
        style={{
          background: '#FF4D2E',
          color: '#FFFFFF',
          border: 'none',
          padding: isMobile ? '10px 20px' : '12px 28px',
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: isMobile ? '13px' : '15px',
          cursor: 'pointer',
          maxWidth: '320px',
          width: '100%',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#E6431F'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#FF4D2E'; }}
      >
        Upload your first document →
      </button>

      {/* Accepted types hint */}
      <p style={{ fontFamily: "'Space Mono', monospace", fontSize: isMobile ? '9px' : '11px', color: '#6B6862', marginTop: '12px' }}>
        PDF · DOCX · TXT · MD · up to 10 MB
      </p>
    </div>
  );
}
