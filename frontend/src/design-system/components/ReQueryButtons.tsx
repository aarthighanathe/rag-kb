/**
 * @file ReQueryButtons.tsx
 * @description Three re-query buttons that let users ask a variant of the last
 *   question scoped to a single source document.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReQueryButtonsProps {
  /** The original query text */
  originalQuery: string;
  /** Callback when a variant is clicked — passes the reworded query */
  onReQuery: (query: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shows 3 re-query variants for last assistant answer.
 */
export function ReQueryButtons({ originalQuery, onReQuery }: ReQueryButtonsProps): React.JSX.Element {
  const variants = [
    `Summarize "${originalQuery}" in 3 bullet points`,
    `What are the key takeaways of "${originalQuery}"?`,
    `Explain "${originalQuery}" to a beginner`,
  ];

  return (
    <div data-testid="re-query-buttons" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
      {variants.map((variant) => (
        <button
          key={variant}
          type="button"
          data-testid="re-query-btn"
          onClick={() => onReQuery(variant)}
          style={{
            background: '#F7F5F0',
            border: '1px solid #D8D4C8',
            color: '#5C5850',
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: '11px',
            padding: '4px 10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'border-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#FF4D2E';
            (e.currentTarget as HTMLButtonElement).style.color = '#1C1B19';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#D8D4C8';
            (e.currentTarget as HTMLButtonElement).style.color = '#5C5850';
          }}
        >
          {variant}
        </button>
      ))}
    </div>
  );
}
