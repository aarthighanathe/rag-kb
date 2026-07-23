/**
 * @file Input.tsx
 * @description Form input — Lab Notebook theme. Underline-only border (ruled-paper feel),
 *   wide-tracked uppercase label, stamp-colored focus state.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import React, { useId } from 'react';
import { X } from 'lucide-react';

export type InputVariant = 'default' | 'error' | 'success';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label rendered above the input. */
  label?: string;
  /** Supplemental text rendered below the input. */
  helperText?: string;
  /** Error message — switches input to error variant when provided. */
  errorMessage?: string;
  /** Explicit variant override (errorMessage auto-sets 'error'). */
  variant?: InputVariant;
  /** Shows remaining characters when maxLength is also set. */
  showCharCount?: boolean;
  /** Renders an × button to clear the value (controlled inputs must handle onChange). */
  clearable?: boolean;
  /** Callback fired when the clear button is pressed. */
  onClear?: () => void;
  /** Icon rendered on the left inside the input. */
  iconLeft?: React.ReactNode;
  /** Icon rendered on the right inside the input. */
  iconRight?: React.ReactNode;
}

/**
 * Accessible text input with underline styling, label, helper, error, and icon slots.
 * @param label        - Visible label text (uppercase, tracked)
 * @param helperText   - Hint text rendered below the field
 * @param errorMessage - Error text; also switches variant to 'error'
 * @param variant      - Visual state (default / error / success)
 * @param showCharCount - Show current / max character counter
 * @param clearable    - Render a clear (×) button when value is non-empty
 * @param onClear      - Fired when clear button is clicked
 * @param iconLeft     - Node rendered inside left padding
 * @param iconRight    - Node rendered inside right padding
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      errorMessage,
      variant: variantProp = 'default',
      showCharCount = false,
      clearable = false,
      onClear,
      iconLeft,
      iconRight,
      id: idProp,
      maxLength,
      value,
      className = '',
      disabled,
      ...rest
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const helperId = `${id}-helper`;
    const errorId  = `${id}-error`;

    const variant: InputVariant = errorMessage ? 'error' : variantProp;
    const currentLength = typeof value === 'string' ? value.length : 0;
    const hasRightAction = clearable || iconRight;

    // Underline border — changes color on state
    const underlineClass =
      variant === 'error'
        ? 'border-b-ds-error focus-within:border-b-ds-error'
        : variant === 'success'
        ? 'border-b-ds-archive focus-within:border-b-ds-archive'
        : 'border-b-ds-hairline focus-within:border-b-ds-stamp';

    return (
      <div className={`flex flex-col gap-ds-1 ${className}`}>
        {label && (
          <label
            htmlFor={id}
            className="text-ds-xs font-body font-medium text-ds-text-secondary tracking-ds-wider uppercase"
          >
            {label}
          </label>
        )}

        {/* Input row — underline only, no box border */}
        <div
          className={`
            flex items-center gap-ds-2
            border-b-[1.5px] bg-transparent
            transition-colors duration-ds-normal ease-ds-smooth
            ${underlineClass}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {iconLeft && (
            <span className="shrink-0 text-ds-text-muted" aria-hidden="true">
              {iconLeft}
            </span>
          )}

          <input
            ref={ref}
            id={id}
            value={value}
            maxLength={maxLength}
            disabled={disabled}
            aria-describedby={
              [helperText ? helperId : '', errorMessage ? errorId : ''].filter(Boolean).join(' ') || undefined
            }
            aria-invalid={variant === 'error' ? 'true' : undefined}
            className={`
              flex-1 min-w-0 bg-transparent
              px-0 py-ds-2
              text-ds-base text-ds-text-primary font-body
              placeholder:text-ds-text-muted
              outline-none
              ${hasRightAction ? 'pr-0' : ''}
              disabled:cursor-not-allowed
            `}
            {...rest}
          />

          {clearable && value && String(value).length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear input"
              tabIndex={0}
              className="shrink-0 text-ds-text-muted hover:text-ds-text-primary transition-colors pb-1"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}

          {iconRight && !clearable && (
            <span className="shrink-0 text-ds-text-muted pb-1" aria-hidden="true">
              {iconRight}
            </span>
          )}
        </div>

        <div className="flex items-start justify-between gap-2">
          <div>
            {errorMessage && (
              <p id={errorId} role="alert" className="text-ds-xs font-body text-ds-error mt-0.5">
                {errorMessage}
              </p>
            )}
            {helperText && !errorMessage && (
              <p id={helperId} className="text-ds-xs font-body text-ds-text-muted mt-0.5">
                {helperText}
              </p>
            )}
          </div>

          {showCharCount && maxLength !== undefined && (
            <p
              aria-live="polite"
              className={`text-ds-xs font-mono-data shrink-0 mt-0.5 ${
                currentLength >= maxLength ? 'text-ds-error' : 'text-ds-text-muted'
              }`}
            >
              {currentLength}/{maxLength}
            </p>
          )}
        </div>
      </div>
    );
  },
);

Input.displayName = 'Input';
