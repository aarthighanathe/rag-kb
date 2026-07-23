/**
 * @file Landing.tsx
 * @description Marketing landing page — eight-section full-bleed layout that
 *   showcases the full feature set (retrieval, citations, confidence scoring,
 *   split-screen mode, document relationship map, export, history, shortcuts).
 *   Section 1: Minimal nav. Section 2: 50/50 hero split with a static chat mock.
 *   Section 3: Ticker bar. Section 4: "THE DIFFERENCE" before/after comparison
 *   (3 rows). Section 5: Three-step panels. Section 6: Split-screen showcase.
 *   Section 7: Stats bar. Section 8: Footer CTA.
 *   No AppHeader (standalone minimal nav). Sharp corners throughout.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { BookOpen, Columns2, HelpCircle, Copy, Download, ChevronDown, ArrowRight, ShieldCheck } from 'lucide-react';

// ---------------------------------------------------------------------------
// Local design-token aliases (values mirror design-system/tokens.ts exactly —
// kept inline here to match this file's existing self-contained style).
// ---------------------------------------------------------------------------

const FONT_DISPLAY = "'Fraunces Variable', Georgia, 'Times New Roman', serif";
const FONT_BODY = "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_MONO = "'Space Mono', 'Courier New', monospace";

const C = {
  inkBase: '#1C1B19',
  inkDeep: '#141310',
  inkBorder: '#2C2B29',
  inkSecondary: '#5C5850',
  inkMuted: '#8A8578',
  inkHint: '#B8B4AC',
  paperBase: '#F7F5F0',
  paperDeep: '#EFEDE6',
  paperBorder: '#D8D4C8',
  paperMuted: '#F0EDEA',
  paperSurface: '#FCFBF8',
  white: '#FFFFFF',
  stampRed: '#FF4D2E',
  stampRedBg: '#FFF3E0',
  archiveGreen: '#2D5A4A',
} as const;

// ---------------------------------------------------------------------------
// Section 1: Minimal nav
// ---------------------------------------------------------------------------

function LandingNav(): React.JSX.Element {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const target = isSignedIn ? '/upload' : '/sign-in';
  return (
    <header
      style={{ background: C.inkBase, height: '54px', flexShrink: 0 }}
      className="w-full flex items-center justify-between px-6 sm:px-10"
    >
      <Link
        to="/"
        aria-label="RAG KB"
        className="flex items-center gap-2 focus-visible:outline-none"
        style={{ textDecoration: 'none' }}
      >
        <BookOpen size={16} aria-hidden="true" style={{ color: C.paperBase }} />
        <span
          className="font-display font-black"
          style={{ fontSize: '20px', color: C.paperBase, fontVariationSettings: "'opsz' 10" }}
        >
          RAG KB
        </span>
      </Link>

      <button
        type="button"
        data-testid="nav-open-app"
        onClick={() => navigate(target)}
        style={{
          background: C.stampRed,
          color: C.white,
          border: 'none',
          padding: '9px 20px',
          fontFamily: FONT_BODY,
          fontWeight: 700,
          fontSize: '13px',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {isSignedIn ? 'Open app →' : 'Sign in →'}
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section 2: 50/50 Hero — static chat mock on the right
// ---------------------------------------------------------------------------

function HeroChatMock(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        background: C.paperBase,
        border: `1px solid ${C.paperBorder}`,
        boxShadow: '0 4px 16px rgba(28,27,25,0.12)',
        width: '100%',
        maxWidth: '400px',
        margin: '0 auto',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.paperBorder}`,
        }}
      >
        <span className="font-display" style={{ fontWeight: 700, fontSize: '13px', color: C.inkBase }}>
          Reading Room
        </span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: FONT_MONO,
              fontSize: '9px',
              color: C.inkMuted,
              border: `1px solid ${C.paperBorder}`,
              padding: '3px 6px',
            }}
          >
            <Columns2 size={10} /> Split
          </span>
          <span style={{ border: `1px solid ${C.paperBorder}`, padding: '3px 6px', display: 'flex' }}>
            <HelpCircle size={10} color={C.inkMuted} />
          </span>
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        {/* User bubble */}
        <div
          style={{
            background: C.inkBase,
            color: C.paperBase,
            padding: '8px 12px',
            fontFamily: FONT_BODY,
            fontSize: '12px',
            marginLeft: 'auto',
            marginBottom: '12px',
            maxWidth: '88%',
          }}
        >
          What are the key financial risks?
        </div>

        {/* Answer */}
        <div
          style={{
            borderLeft: `3px solid ${C.archiveGreen}`,
            background: C.paperMuted,
            padding: '10px 12px',
            marginBottom: '10px',
          }}
        >
          <p style={{ fontFamily: FONT_BODY, fontSize: '12px', color: C.inkBase, lineHeight: 1.6 }}>
            The primary risks include market volatility{' '}
            <sup
              style={{
                background: C.archiveGreen,
                color: C.white,
                fontFamily: FONT_MONO,
                fontSize: '8px',
                borderRadius: '50%',
                padding: '1px 4px',
              }}
            >
              1
            </sup>{' '}
            and currency exposure{' '}
            <sup
              style={{
                background: C.archiveGreen,
                color: C.white,
                fontFamily: FONT_MONO,
                fontSize: '8px',
                borderRadius: '50%',
                padding: '1px 4px',
              }}
            >
              2
            </sup>{' '}
            per the Q3 report.
          </p>
        </div>

        {/* Confidence bar */}
        <div style={{ marginBottom: '12px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: FONT_MONO,
              fontSize: '9px',
              fontWeight: 700,
              color: C.archiveGreen,
              marginBottom: '4px',
              letterSpacing: '0.05em',
            }}
          >
            <span>HIGH CONFIDENCE</span>
            <span>78%</span>
          </div>
          <div style={{ height: '5px', background: C.paperBorder }}>
            <div style={{ width: '78%', height: '100%', background: C.archiveGreen }} />
          </div>
        </div>

        {/* Index cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          {[
            { pct: '94%', src: 'q3.pdf', ref: '§3', quote: '"Revenue volatility increased..."' },
            { pct: '81%', src: 'risk.docx', ref: '§1', quote: '"Currency exposure widened..."' },
          ].map((card) => (
            <div
              key={card.src}
              style={{
                background: C.white,
                border: `1px solid ${C.paperBorder}`,
                padding: '8px 10px',
                position: 'relative',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '-7px',
                  right: '-5px',
                  background: C.stampRed,
                  color: C.white,
                  fontFamily: FONT_MONO,
                  fontSize: '8px',
                  fontWeight: 700,
                  padding: '2px 5px',
                }}
              >
                {card.pct}
              </span>
              <p style={{ fontFamily: FONT_MONO, fontSize: '8px', color: C.inkMuted, marginBottom: '3px' }}>
                {card.src} · {card.ref}
              </p>
              <p style={{ fontFamily: FONT_MONO, fontSize: '9px', color: C.inkSecondary, lineHeight: 1.35 }}>
                {card.quote}
              </p>
            </div>
          ))}
        </div>

        {/* Relevance timeline toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: FONT_MONO,
            fontSize: '9px',
            color: C.inkMuted,
            marginBottom: '10px',
          }}
        >
          <ChevronDown size={11} /> Show retrieval scores
        </div>

        {/* Action bar */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            borderTop: `1px dashed ${C.paperBorder}`,
            paddingTop: '10px',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT_MONO, fontSize: '9px', color: C.inkSecondary }}>
            <Copy size={10} /> Copy
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT_MONO, fontSize: '9px', color: C.inkSecondary }}>
            <Download size={10} /> Export
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT_MONO, fontSize: '9px', color: C.inkSecondary }}>
            TRY WITH ONLY: <ChevronDown size={9} />
          </span>
        </div>
      </div>
    </div>
  );
}

function HeroSection(): React.JSX.Element {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const target = isSignedIn ? '/upload' : '/sign-in';

  return (
    <section
      style={{ display: 'flex', minHeight: '560px', flexShrink: 0 }}
      className="flex-col md:flex-row"
      aria-label="Hero section"
    >
      {/* Left panel — ink.base */}
      <div
        style={{
          flex: 1,
          background: C.inkBase,
          backgroundImage: `radial-gradient(560px circle at 15% 20%, rgba(255,77,46,0.16), transparent 60%)`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
        className="px-8 sm:px-10 md:px-12 py-10 md:py-14"
      >
        <p
          style={{
            fontFamily: FONT_MONO,
            fontSize: '10px',
            letterSpacing: '0.16em',
            color: C.stampRed,
            marginBottom: '20px',
            textTransform: 'uppercase',
          }}
        >
          RAG KNOWLEDGE BASE
        </p>

        <h1
          className="font-display"
          style={{
            fontWeight: 900,
            lineHeight: 1.0,
            color: C.paperBase,
            marginBottom: '24px',
            fontStyle: 'normal',
            fontSize: 'clamp(28px, calc(5vw + 4px), 52px)',
          }}
        >
          Ask your
          <br />
          documents.
          <br />
          <em style={{ color: C.stampRed, fontStyle: 'italic' }}>Get answers</em>
          <br />
          <em style={{ color: C.stampRed, fontStyle: 'italic' }}>with receipts.</em>
        </h1>

        <p
          style={{
            fontFamily: FONT_BODY,
            fontSize: '16px',
            color: C.inkMuted,
            lineHeight: 1.7,
            maxWidth: '400px',
            marginBottom: '32px',
          }}
        >
          Upload any document. Ask questions in plain language. Every answer
          arrives with cited source passages, confidence scores, and a full
          retrieval breakdown — so you always know where the answer came from.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap mb-5" style={{ position: 'relative', zIndex: 1 }}>
          <button
            type="button"
            data-testid="hero-cta-primary"
            onClick={() => navigate(target)}
            aria-label="Start for free"
            className="w-full sm:w-auto"
            style={{
              background: C.stampRed,
              color: C.white,
              border: 'none',
              padding: '15px 30px',
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: '15px',
              cursor: 'pointer',
              transition: 'all 150ms ease',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 16px rgba(255,77,46,0.45)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = '';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '';
            }}
          >
            Start for free <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>

        <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.inkHint, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <ShieldCheck size={12} aria-hidden="true" style={{ color: C.archiveGreen }} />
            Private to your account
          </span>
          <span aria-hidden="true" style={{ color: C.inkBorder }}>·</span>
          PDF · DOCX · TXT · MD — 10 MB max · 100% free
        </p>
      </div>

      {/* Right panel — paper.deep (hidden on mobile) */}
      <div
        style={{
          flex: 1,
          background: C.paperDeep,
          backgroundImage: `radial-gradient(circle, ${C.paperBorder} 1px, transparent 1px)`,
          backgroundSize: '18px 18px',
          position: 'relative',
          overflow: 'hidden',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
        className="hidden md:flex px-8 md:px-10 py-10 md:py-12"
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: '-20px',
            right: '-10px',
            fontSize: '140px',
            fontFamily: FONT_DISPLAY,
            fontWeight: 900,
            color: '#E5E2DB',
            lineHeight: 1,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          KB
        </span>

        <HeroChatMock />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 3: Feature ticker bar (continuous marquee)
// ---------------------------------------------------------------------------

const TICKER_ITEMS = [
  'Multi-turn conversation memory',
  'Bidirectional citation highlighting',
  'Confidence scoring on every answer',
  'Split-screen source view',
  'Document relationship map',
  'Export answers as Markdown',
  'Query history with one-click re-run',
  '100% free in production',
];

function TickerBar(): React.JSX.Element {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div style={{ background: C.stampRed, padding: '14px 0', overflow: 'hidden', flexShrink: 0 }} aria-label="Feature highlights">
      <div
        className="flex w-max motion-safe:animate-ticker-scroll hover:[animation-play-state:paused]"
        style={{ gap: '20px', paddingLeft: '20px' }}
      >
        {doubled.map((item, i) => (
          <span
            key={`${item}-${i}`}
            aria-hidden={i >= TICKER_ITEMS.length}
            style={{ display: 'flex', alignItems: 'center', gap: '20px', whiteSpace: 'nowrap' }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.white, fontWeight: 700 }}>
              ▶ {item}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: FONT_MONO, fontSize: '11px' }}>/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4: "THE DIFFERENCE" — before/after comparison
// ---------------------------------------------------------------------------

interface DifferenceRowData {
  id: string;
  oldBody: string;
  rightBg: string;
  labelColor: string;
  bodyColor: string;
  rightBody: React.ReactNode;
}

const DIFFERENCE_ROWS: DifferenceRowData[] = [
  {
    id: 'citations',
    oldBody:
      "Your AI tool gives you an answer. You have no idea where it came from. You can't verify it. You copy it anyway and hope for the best.",
    rightBg: C.inkBase,
    labelColor: C.stampRed,
    bodyColor: C.paperBase,
    rightBody: (
      <>
        Every answer shows the exact passage it drew from — document name,
        chunk number, similarity score. Hover{' '}
        <span
          aria-label="citation marker"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: C.archiveGreen,
            color: C.white,
            fontFamily: FONT_MONO,
            fontSize: '9px',
            verticalAlign: '1px',
          }}
        >
          ①
        </span>{' '}
        to highlight the source. Click to scroll to it.
      </>
    ),
  },
  {
    id: 'memory',
    oldBody:
      '"What about their subsidiaries?" — your AI has no idea what you\'re talking about. Every question starts from scratch.',
    rightBg: C.archiveGreen,
    labelColor: 'rgba(255,255,255,0.5)',
    bodyColor: C.white,
    rightBody:
      'Follow-up questions work. The last 3 exchanges are included as context in every new query — so you can dig deeper without re-explaining.',
  },
  {
    id: 'confidence',
    oldBody:
      'You upload 10 documents and ask a question. You get one answer. You have no idea which documents contributed, how confident the system is, or what it missed.',
    rightBg: C.stampRedBg,
    labelColor: '#B8501A',
    bodyColor: C.inkBase,
    rightBody: (
      <>
        A confidence score on every answer (HIGH · MEDIUM · LOW). A bar chart
        of all retrieved chunk scores. A document relationship map. You see
        everything.
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px' }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: C.archiveGreen, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            HIGH CONFIDENCE
          </span>
          <div style={{ flex: 1, height: '4px', background: C.paperBorder }}>
            <div style={{ width: '78%', height: '100%', background: C.archiveGreen }} />
          </div>
          <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: C.inkMuted }}>78%</span>
        </div>
      </>
    ),
  },
];

function DifferenceSection(): React.JSX.Element {
  return (
    <section
      data-testid="difference-section"
      style={{ background: C.paperBase, flexShrink: 0 }}
      className="px-5 py-10 md:px-10 md:py-14"
      aria-labelledby="difference-heading"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '48px' }}>
        <span
          id="difference-heading"
          style={{
            fontFamily: FONT_MONO,
            fontSize: '10px',
            color: C.stampRed,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          THE DIFFERENCE
        </span>
        <div style={{ flex: 1, height: '1px', background: C.paperBorder }} />
      </div>

      <div>
        {DIFFERENCE_ROWS.map((row, i) => (
          <div
            key={row.id}
            data-testid="difference-row"
            className="grid grid-cols-1 md:grid-cols-2"
            style={{
              border: `1px solid ${C.paperBorder}`,
              marginBottom: i < DIFFERENCE_ROWS.length - 1 ? '-1px' : 0,
            }}
          >
            {/* Left — THE OLD WAY */}
            <div
              className="relative p-5 md:p-8"
              style={{ background: C.paperDeep, borderRight: `1px solid ${C.paperBorder}` }}
            >
              <div
                aria-hidden="true"
                className="hidden md:block absolute"
                style={{ top: '-1px', left: '-1px', right: '-1px', height: '3px', background: C.inkHint }}
              />
              <p
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: FONT_MONO,
                  fontSize: '9px',
                  letterSpacing: '0.12em',
                  color: C.inkMuted,
                  marginBottom: '14px',
                  textTransform: 'uppercase',
                }}
              >
                <span aria-hidden="true" style={{ color: C.inkHint }}>✕</span> THE OLD WAY
              </p>
              <p className="text-[15px] md:text-[17px]" style={{ fontFamily: FONT_BODY, color: C.inkBase, lineHeight: 1.6 }}>
                {row.oldBody}
              </p>
            </div>

            {/* Right — RAG KB */}
            <div
              className="relative p-5 md:p-8 border-l-[3px] md:border-l-0"
              style={{ background: row.rightBg, borderColor: C.stampRed }}
            >
              <div
                aria-hidden="true"
                className="hidden md:block absolute"
                style={{ top: '-1px', left: '-1px', right: '-1px', height: '3px', background: C.stampRed }}
              />
              <p
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: '9px',
                  letterSpacing: '0.12em',
                  color: row.labelColor,
                  marginBottom: '14px',
                  textTransform: 'uppercase',
                }}
              >
                RAG KB
              </p>
              <div className="text-[15px] md:text-[17px]" style={{ fontFamily: FONT_BODY, color: row.bodyColor, lineHeight: 1.6 }}>
                {row.rightBody}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between flex-wrap gap-3" style={{ marginTop: '32px' }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.inkMuted }}>
          Plus: export answers as Markdown · split-screen source view · document relationship map · query history
        </span>
        <a
          href="#how-it-works"
          className="hidden min-[481px]:inline-block"
          style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.stampRed, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          See all features →
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 5: Three-step panels — "From filing to findings"
// ---------------------------------------------------------------------------

function ThreeStepSection(): React.JSX.Element {
  return (
    <section
      id="how-it-works"
      data-testid="how-it-works"
      style={{ background: C.paperBase, flexShrink: 0 }}
      aria-labelledby="how-heading"
    >
      <div style={{ padding: '56px 40px 0', display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '40px' }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: '10px',
            color: C.stampRed,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          THREE STEPS
        </span>
        <div style={{ flex: 1, height: '1px', background: C.paperBorder }} />
      </div>

      <div style={{ padding: '0 40px 0' }}>
        <h2
          id="how-heading"
          className="font-display"
          style={{ fontSize: '44px', fontWeight: 900, color: C.inkBase, marginBottom: '40px', lineHeight: 1.1 }}
        >
          From filing
          <br />
          <em style={{ fontStyle: 'italic', color: C.stampRed }}>to findings.</em>
        </h2>
      </div>

      <div style={{ display: 'grid', border: `1px solid ${C.paperBorder}`, margin: '0' }} className="grid-cols-1 md:grid-cols-3">
        {/* Panel 1 — FILE IT */}
        <div style={{ background: C.white, borderRight: `1px solid ${C.paperBorder}`, padding: '32px', position: 'relative' }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              fontFamily: FONT_MONO,
              fontSize: '60px',
              fontWeight: 700,
              color: '#F0EDEA',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            01
          </span>
          <span
            style={{
              background: C.stampRed,
              color: C.white,
              fontFamily: FONT_MONO,
              fontSize: '10px',
              letterSpacing: '0.1em',
              padding: '4px 10px',
              display: 'inline-block',
              marginBottom: '16px',
            }}
          >
            FILE IT
          </span>
          <h3 className="font-display" style={{ fontSize: '28px', fontWeight: 900, fontStyle: 'italic', color: C.inkBase, marginBottom: '12px' }}>
            Drop it in.
          </h3>
          <p style={{ fontFamily: FONT_BODY, fontSize: '14px', color: C.inkSecondary, lineHeight: 1.7, marginBottom: '16px' }}>
            Drag PDFs, Word docs, Markdown, or plain text into the upload zone.
            Each file is validated (magic bytes, not just extension), chunked
            into 512-token segments with 50-token overlap, and embedded via
            HuggingFace — automatically, with no configuration.
          </p>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '10px',
              color: C.inkMuted,
              borderTop: `1px dashed ${C.paperBorder}`,
              paddingTop: '12px',
            }}
          >
            PDF · DOCX · TXT · MD · magic-byte validated
          </p>
        </div>

        {/* Panel 2 — ASK IT */}
        <div style={{ background: C.archiveGreen, borderRight: '1px solid rgba(255,255,255,0.1)', padding: '32px', position: 'relative' }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              fontFamily: FONT_MONO,
              fontSize: '60px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.08)',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            02
          </span>
          <span
            style={{
              background: C.white,
              color: C.archiveGreen,
              fontFamily: FONT_MONO,
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              padding: '4px 10px',
              display: 'inline-block',
              marginBottom: '16px',
            }}
          >
            ASK IT
          </span>
          <h3 className="font-display" style={{ fontSize: '28px', fontWeight: 900, fontStyle: 'italic', color: C.white, marginBottom: '12px' }}>
            Just ask.
          </h3>
          <p style={{ fontFamily: FONT_BODY, fontSize: '14px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, marginBottom: '16px' }}>
            Type your question in plain language. The query is embedded and
            compared against all indexed chunks by cosine similarity. You can
            query all documents at once or filter to specific sources.
          </p>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '11px',
              color: 'rgba(255,255,255,0.5)',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              paddingTop: '12px',
            }}
          >
            semantic search · pgvector · IVFFlat
          </p>
        </div>

        {/* Panel 3 — CITE IT */}
        <div style={{ background: C.inkBase, padding: '32px', position: 'relative' }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              fontFamily: FONT_MONO,
              fontSize: '60px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.05)',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            03
          </span>
          <span
            style={{
              background: C.stampRed,
              color: C.white,
              fontFamily: FONT_MONO,
              fontSize: '10px',
              letterSpacing: '0.1em',
              padding: '4px 10px',
              display: 'inline-block',
              marginBottom: '16px',
            }}
          >
            CITE IT
          </span>
          <h3 className="font-display" style={{ fontSize: '28px', fontWeight: 900, fontStyle: 'italic', color: C.paperBase, marginBottom: '12px' }}>
            Trace it back.
          </h3>
          <p style={{ fontFamily: FONT_BODY, fontSize: '14px', color: C.inkMuted, lineHeight: 1.7, marginBottom: '16px' }}>
            Every answer includes the exact passages it drew from — chunk
            reference, similarity score, full source text. Hover a citation to
            highlight its card. Click to scroll to it. Nothing goes unverified.
          </p>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '11px',
              color: C.inkHint,
              borderTop: `1px solid ${C.inkBorder}`,
              paddingTop: '12px',
            }}
          >
            confidence score · citation highlight · export
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 6: Split-screen showcase
// ---------------------------------------------------------------------------

const SHOWCASE_BULLETS = [
  '◼ Cards animate in sequentially as chunks arrive',
  '◼ Hover citations in the answer → card highlights right',
  '◼ Hover a source card → cited text highlights left',
  '◼ Preference saved to localStorage',
  '◼ Disabled automatically on mobile (<768px)',
];

function ShowcaseMock(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        background: C.white,
        border: `1px solid ${C.paperBorder}`,
        boxShadow: '0 4px 16px rgba(28,27,25,0.12)',
        display: 'flex',
        overflow: 'hidden',
      }}
      className="flex-col sm:flex-row"
    >
      {/* Left — answer column (60%) */}
      <div style={{ flex: '1 1 60%', padding: '18px', borderRight: `1px solid ${C.paperBorder}` }}>
        <p style={{ fontFamily: FONT_MONO, fontSize: '9px', color: C.inkMuted, marginBottom: '10px', textTransform: 'uppercase' }}>
          ANSWER
        </p>
        <p style={{ fontFamily: FONT_BODY, fontSize: '13px', color: C.inkBase, lineHeight: 1.7 }}>
          Market volatility remains the primary concern{' '}
          <sup style={{ background: C.archiveGreen, color: C.white, fontFamily: FONT_MONO, fontSize: '8px', borderRadius: '50%', padding: '1px 4px' }}>1</sup>{' '}
          with additional exposure from currency fluctuations{' '}
          <sup style={{ background: C.archiveGreen, color: C.white, fontFamily: FONT_MONO, fontSize: '8px', borderRadius: '50%', padding: '1px 4px' }}>2</sup>{' '}
          noted in the Q3 filing.
        </p>
      </div>

      {/* Right — source panel (40%) */}
      <div style={{ flex: '1 1 40%', padding: '18px', background: C.paperMuted }}>
        <p style={{ fontFamily: FONT_MONO, fontSize: '9px', color: C.inkSecondary, marginBottom: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>
          SOURCE DOCUMENTS [2]
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
          {[
            { pct: '94%', src: 'q3.pdf · Chunk 3' },
            { pct: '81%', src: 'risk.docx · Chunk 1' },
          ].map((card) => (
            <div key={card.src} style={{ background: C.white, border: `1px solid ${C.paperBorder}`, padding: '8px 10px', position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-4px',
                  background: C.stampRed,
                  color: C.white,
                  fontFamily: FONT_MONO,
                  fontSize: '8px',
                  fontWeight: 700,
                  padding: '2px 5px',
                }}
              >
                {card.pct}
              </span>
              <p style={{ fontFamily: FONT_MONO, fontSize: '9px', color: C.inkMuted }}>{card.src}</p>
            </div>
          ))}
        </div>
        {/* Relevance timeline bars — expanded */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {[
            { label: 'q3.pdf', pct: 94 },
            { label: 'risk.docx', pct: 81 },
            { label: 'notes.md', pct: 52 },
          ].map((bar) => (
            <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ flex: 1, height: '6px', background: C.paperBorder }}>
                <div style={{ width: `${bar.pct}%`, height: '100%', background: C.archiveGreen }} />
              </div>
              <span style={{ fontFamily: FONT_MONO, fontSize: '8px', color: C.inkMuted, whiteSpace: 'nowrap' }}>
                {bar.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShowcaseSection(): React.JSX.Element {
  return (
    <section style={{ background: C.paperDeep, padding: '56px 40px', flexShrink: 0 }} aria-labelledby="showcase-heading">
      <div style={{ display: 'flex', gap: '48px' }} className="flex-col md:flex-row md:items-center">
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '10px',
              color: C.stampRed,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom: '16px',
            }}
          >
            SPLIT-SCREEN MODE
          </p>
          <h2
            id="showcase-heading"
            className="font-display"
            style={{ fontSize: '36px', fontWeight: 900, fontStyle: 'italic', color: C.inkBase, marginBottom: '20px', lineHeight: 1.15 }}
          >
            Read the answer and its sources side by side.
          </h2>
          <p style={{ fontFamily: FONT_BODY, fontSize: '16px', color: C.inkSecondary, lineHeight: 1.7, marginBottom: '24px' }}>
            Enable split-screen to see retrieved source chunks update live in
            the right panel as your answer streams in the left. The source
            panel shows the full confidence bar, all retrieved cards at full
            width, and the relevance score chart — expanded by default, no
            toggle needed.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {SHOWCASE_BULLETS.map((line) => (
              <span key={line} style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.inkSecondary }}>
                {line}
              </span>
            ))}
          </div>
          <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.inkHint }}>
            Toggle it on with the ⊞ button in the chat header.
          </p>
        </div>

        <div style={{ flex: 1 }}>
          <ShowcaseMock />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 7: Honest stats bar
// ---------------------------------------------------------------------------

const STATS = [
  { value: '100%', label: 'FREE IN PRODUCTION' },
  { value: '384', label: 'EMBEDDING DIMENSIONS' },
  { value: '512', label: 'TOKENS PER CHUNK' },
  { value: '0', label: 'HALLUCINATIONS VERIFIED' },
];

function StatsBar(): React.JSX.Element {
  return (
    <section style={{ background: C.inkBase, padding: '32px 40px', flexShrink: 0 }} aria-label="Project stats">
      <div
        className="grid grid-cols-2 md:grid-cols-4 [&>div]:border-t [&>div]:md:border-t-0"
        style={{ borderColor: C.inkBorder }}
      >
        {STATS.map((stat) => (
          <div
            key={stat.label}
            data-testid="stat-item"
            className="md:border-l first:border-l-0 md:first:border-l-0"
            style={{ textAlign: 'center', padding: '16px', borderColor: C.inkBorder }}
          >
            <p className="font-display" style={{ fontSize: '48px', fontWeight: 900, color: C.stampRed, lineHeight: 1 }}>
              {stat.value}
            </p>
            <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: C.inkMuted, letterSpacing: '0.1em', marginTop: '8px' }}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 8: Footer CTA
// ---------------------------------------------------------------------------

function FooterCTA(): React.JSX.Element {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const target = isSignedIn ? '/upload' : '/sign-in';
  return (
    <footer role="contentinfo" style={{ background: C.stampRed, flexShrink: 0 }}>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-8 md:px-10 lg:px-12 py-10 md:py-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8 md:gap-12">
          <div className="flex-1 min-w-0">
            <p
              className="font-display"
              style={{
                fontSize: 'clamp(22px, 3vw, 28px)',
                fontWeight: 900,
                fontStyle: 'italic',
                color: C.white,
                marginBottom: '8px',
                lineHeight: 1.15,
              }}
            >
              Ready to file your first document?
            </p>
            <p style={{ fontFamily: FONT_BODY, fontSize: '14px', color: 'rgba(255,255,255,0.7)', maxWidth: '420px' }}>
              Free forever. No credit card. No rate limits that matter for personal use.
            </p>

            <nav aria-label="Footer navigation" style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap' }}>
              <Link to="/upload" style={{ fontFamily: FONT_BODY, fontSize: '13px', color: 'rgba(255,255,255,0.8)', textDecoration: 'underline' }}>
                Acquisitions Desk
              </Link>
              <Link to="/chat" style={{ fontFamily: FONT_BODY, fontSize: '13px', color: 'rgba(255,255,255,0.8)', textDecoration: 'underline' }}>
                Reading Room
              </Link>
              <Link to="/documents" style={{ fontFamily: FONT_BODY, fontSize: '13px', color: 'rgba(255,255,255,0.8)', textDecoration: 'underline' }}>
                Archive
              </Link>
            </nav>
          </div>

          <button
            type="button"
            onClick={() => navigate(target)}
            aria-label="Open the app"
            className="w-full md:w-auto shrink-0 self-start md:self-center"
            style={{
              background: C.inkBase,
              color: C.white,
              border: 'none',
              padding: '16px 36px',
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'background 150ms ease, transform 150ms ease, box-shadow 150ms ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = C.inkDeep;
              btn.style.transform = 'translateY(-2px)';
              btn.style.boxShadow = '0 4px 12px rgba(28,27,25,0.35)';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = C.inkBase;
              btn.style.transform = '';
              btn.style.boxShadow = '';
            }}
          >
            Open the app →
          </button>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Landing page root
// ---------------------------------------------------------------------------

/**
 * Marketing landing page — eight-section full-bleed layout.
 * Mounted at route "/". No interior AppHeader.
 * Already-signed-in visitors are bounced straight to /upload — the marketing
 * page is only useful to people deciding whether to sign up, not returning users.
 */
export function Landing(): React.JSX.Element {
  const { isSignedIn, isLoaded } = useAuth();

  // Wait for Clerk to hydrate before deciding — redirecting on a false "not
  // signed in" read (before the session loads) would flash the landing page
  // at every signed-in user on every visit.
  if (isLoaded && isSignedIn) {
    return <Navigate to="/upload" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: C.paperBase }}>
      <LandingNav />
      <HeroSection />
      <TickerBar />
      <DifferenceSection />
      <ThreeStepSection />
      <ShowcaseSection />
      <StatsBar />
      <FooterCTA />
    </div>
  );
}
