/**
 * @file Badge.tsx
 * @description Compact status badge — Lab Notebook theme. Sharp corners, uppercase
 *   Space Mono text, looks like a library-card stamp or classification label.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'citation';
export type BadgeSize    = 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic color variant. */
  variant?: BadgeVariant;
  /** Size of the badge. */
  size?: BadgeSize;
  /** When true, prepends a small colored dot. */
  dot?: boolean;
  /** Badge label text. */
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:  'bg-ds-base         text-ds-text-secondary border border-ds-hairline',
  success:  'bg-ds-archive/10   text-ds-archive        border border-ds-archive/30',
  warning:  'bg-ds-amber/10     text-ds-warning        border border-ds-amber/30',
  danger:   'bg-ds-rose/10      text-ds-error          border border-ds-rose/30',
  // Dotted border for citation — library card stamp look
  citation: 'bg-ds-archive/10   text-ds-archive        border border-dashed border-ds-archive/50',
};

const dotColor: Record<BadgeVariant, string> = {
  default:  'bg-ds-text-muted',
  success:  'bg-ds-archive',
  warning:  'bg-ds-warning',
  danger:   'bg-ds-error',
  citation: 'bg-ds-archive',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0   text-[10px] gap-1',
  md: 'px-2   py-0.5 text-ds-xs  gap-1.5',
};

/**
 * Compact status label for document states, tags, and citation markers.
 * @param variant  - Semantic color (default: 'default')
 * @param size     - sm | md (default: 'md')
 * @param dot      - Show a filled-dot status indicator before the text
 * @param children - Badge content
 */
export function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  children,
  className = '',
  ...rest
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={`
        inline-flex items-center rounded-[2px] font-mono uppercase tracking-ds-wide font-normal
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`rounded-full shrink-0 ${dotColor[variant]} ${size === 'sm' ? 'h-1 w-1' : 'h-1.5 w-1.5'}`}
        />
      )}
      {children}
    </span>
  );
}
