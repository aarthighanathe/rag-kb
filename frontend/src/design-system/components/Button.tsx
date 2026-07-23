/**
 * @file Button.tsx
 * @description Polymorphic button component — Lab Notebook theme.
 *   Primary variant uses rubber-stamp red-orange with physical press feedback.
 *   Sharp corners (2px radius) throughout — paper/print aesthetic.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize    = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style of the button. */
  variant?: ButtonVariant;
  /** Size of the button. */
  size?: ButtonSize;
  /** When true, shows a spinner and disables interaction. */
  loading?: boolean;
  /** Icon placed before the label. */
  iconLeft?: React.ReactNode;
  /** Icon placed after the label. */
  iconRight?: React.ReactNode;
  /** When true and no children are provided, renders a square icon-only button. */
  iconOnly?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  // Rubber-stamp red-orange: lift on hover, press on active
  primary:
    'bg-ds-stamp text-white border border-[#CC3D25] ' +
    'hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(255,77,46,0.30)] ' +
    'active:translate-y-px active:shadow-none ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none',

  // White with ink border
  secondary:
    'bg-ds-surface text-ds-text-primary border-[1.5px] border-ds-text-primary ' +
    'hover:bg-ds-base hover:border-ds-stamp hover:text-ds-stamp ' +
    'active:translate-y-px ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',

  // Transparent with underline on hover
  ghost:
    'bg-transparent text-ds-text-secondary border border-transparent ' +
    'hover:text-ds-text-primary hover:underline hover:underline-offset-2 ' +
    'active:translate-y-px ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',

  // Error / danger
  danger:
    'bg-ds-error text-white border border-[#9B2D22] ' +
    'hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(192,57,43,0.25)] ' +
    'active:translate-y-px active:shadow-none ' +
    'disabled:opacity-40 disabled:cursor-not-allowed',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7  px-2.5 gap-1.5 text-ds-xs rounded-[2px]',
  md: 'h-9  px-4   gap-2   text-ds-sm rounded-[2px]',
  lg: 'h-11 px-5   gap-2.5 text-ds-base rounded-[2px]',
};

const iconOnlySizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7  w-7  rounded-[2px]',
  md: 'h-9  w-9  rounded-[2px]',
  lg: 'h-11 w-11 rounded-[2px]',
};

/**
 * Primary action button — all variants, sizes, icons, and loading state.
 * @param variant  - Visual style (default: 'primary')
 * @param size     - Button size (default: 'md')
 * @param loading  - Shows spinner and disables interaction
 * @param iconLeft - Icon rendered before label
 * @param iconRight - Icon rendered after label
 * @param iconOnly - Square layout for icon-only buttons
 * @param children - Button label
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      iconLeft,
      iconRight,
      iconOnly = false,
      children,
      disabled,
      className = '',
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    const baseClasses =
      'inline-flex items-center justify-center font-body font-medium ' +
      'transition-all duration-ds-fast ease-ds-smooth ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-stamp ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-ds-base ' +
      'select-none whitespace-nowrap';

    const sizeClass = iconOnly ? iconOnlySizeClasses[size] : sizeClasses[size];

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClass} ${className}`}
        {...rest}
      >
        {loading ? (
          <LoadingSpinner size="sm" color={variant === 'primary' ? 'white' : 'indigo'} />
        ) : (
          iconLeft && <span aria-hidden="true">{iconLeft}</span>
        )}

        {!iconOnly && children && (
          <span>{children}</span>
        )}

        {!loading && iconRight && (
          <span aria-hidden="true">{iconRight}</span>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';
