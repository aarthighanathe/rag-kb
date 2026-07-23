/**
 * @file LoadingSpinner.tsx
 * @description Loading indicator — Lab Notebook theme.
 *   Replaced circular spinner with a horizontal progress scan line in stamp color.
 *   Fits the paper/print aesthetic better than a spinning circle.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';

export type SpinnerSize  = 'sm' | 'md' | 'lg';
export type SpinnerColor = 'indigo' | 'green' | 'white';

export interface LoadingSpinnerProps {
  /** Width/height scale of the indicator. */
  size?: SpinnerSize;
  /** Color variant — legacy names preserved for API compatibility. */
  color?: SpinnerColor;
  /** Accessible label for screen readers. */
  label?: string;
}

const sizeClasses: Record<SpinnerSize, { track: string; bar: string }> = {
  sm: { track: 'h-0.5 w-8',   bar: 'h-full w-1/3' },
  md: { track: 'h-0.5 w-12',  bar: 'h-full w-1/3' },
  lg: { track: 'h-[2px] w-20', bar: 'h-full w-1/3' },
};

// Legacy color names → new palette
const colorClasses: Record<SpinnerColor, string> = {
  indigo: 'bg-ds-stamp',   // stamp red-orange (was indigo)
  green:  'bg-ds-archive', // archive green
  white:  'bg-white',
};

const trackColorClasses: Record<SpinnerColor, string> = {
  indigo: 'bg-ds-stamp/20',
  green:  'bg-ds-archive/20',
  white:  'bg-white/20',
};

/**
 * Horizontal indeterminate progress bar — replaces circular spinner.
 * @param size  - sm | md | lg (default: 'md')
 * @param color - indigo | green | white (default: 'indigo')
 * @param label - Screen-reader label (default: 'Loading…')
 */
export function LoadingSpinner({
  size = 'md',
  color = 'indigo',
  label = 'Loading…',
}: LoadingSpinnerProps): React.JSX.Element {
  const { track, bar } = sizeClasses[size];

  return (
    <span role="status" aria-label={label} className="inline-flex shrink-0 items-center">
      <span
        aria-hidden="true"
        className={`relative overflow-hidden rounded-none ${track} ${trackColorClasses[color]}`}
      >
        <span
          className={`absolute left-0 top-0 ${bar} ${colorClasses[color]} animate-progress-scan`}
          style={{ borderRadius: '1px' }}
        />
      </span>
    </span>
  );
}
