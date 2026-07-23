/**
 * @file EmptyState.tsx
 * @description Empty state placeholder — Lab Notebook theme.
 *   Line-art icon in ink.muted, Fraunces italic message (feels like a handwritten note
 *   on an empty page), Space Grotesk description.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';

export interface EmptyStateProps {
  /** Icon node — typically a Lucide icon at size 40-48. */
  icon: React.ReactNode;
  /** Primary heading — rendered in Fraunces italic. */
  title: string;
  /** Secondary explanatory text. */
  description?: string;
  /** Action button rendered below the description. */
  action?: React.ReactNode;
  /** Additional CSS classes on the root element. */
  className?: string;
}

/**
 * Placeholder layout for empty lists and blank-slate views.
 * @param icon        - Large icon above the heading
 * @param title       - Heading text (Fraunces italic)
 * @param description - Explanatory paragraph
 * @param action      - CTA button node
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      data-testid="empty-state"
      role="status"
      aria-label={title}
      className={`
        flex flex-col items-center justify-center gap-ds-4
        py-ds-24 px-ds-8 text-center
        ${className}
      `}
    >
      {/* Icon wrapper — subtle hairline square, no glow */}
      <div
        aria-hidden="true"
        className="
          flex items-center justify-center
          h-20 w-20 rounded-[2px]
          bg-ds-base border border-ds-hairline
          text-ds-text-muted
          animate-fade-in
          hover:text-ds-stamp hover:border-ds-stamp/30
          transition-all duration-ds-slow ease-ds-smooth
        "
      >
        {icon}
      </div>

      <div className="max-w-xs">
        {/* Fraunces italic — handwritten note feel */}
        <h3
          className="text-ds-lg font-display font-bold text-ds-text-primary"
          style={{ fontStyle: 'italic' }}
        >
          {title}
        </h3>
        {description && (
          <p className="text-ds-sm font-body text-ds-text-secondary mt-ds-2 leading-ds-relaxed">
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-ds-2">{action}</div>}
    </div>
  );
}
