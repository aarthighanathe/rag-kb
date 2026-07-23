/**
 * @file Select.tsx
 * @description Custom-styled select — Lab Notebook theme. Underline border matching
 *   Input.tsx, Space Grotesk font, custom chevron, sharp corners. Wraps native
 *   <select> so keyboard/screen-reader behaviour is unchanged.
 * @author [Author Placeholder]
 * @created 2026-06-20
 */

import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Label shown above the select (optional). */
  label?: string;
  /** Options array rendered as <option> elements. */
  options: SelectOption[];
  /** Current selected value. */
  value: string;
  /** Change handler — receives the new string value. */
  onChange: (value: string) => void;
  /** Accessible label when no visible label is used. */
  'aria-label'?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Additional classes on the wrapper div. */
  className?: string;
  /** data-testid forwarded to the inner <select>. */
  'data-testid'?: string;
}

/**
 * Styled select dropdown matching the Lab Notebook underline-input aesthetic.
 * Uses a native <select> internally — keyboard, screen-reader and form behaviour
 * are identical to a plain select element.
 *
 * @param label       - Optional visible label above the select
 * @param options     - [{value, label}] array
 * @param value       - Controlled value
 * @param onChange    - Change callback
 * @param aria-label  - Accessible label when no visible label is present
 * @param disabled    - Disabled state
 * @param className   - Extra classes on the wrapper
 */
export function Select({
  label,
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  className = '',
  'data-testid': testId,
}: SelectProps): React.JSX.Element {
  const uid = useId();
  const selectId = label ? uid : undefined;

  return (
    <div className={`relative flex flex-col gap-ds-1 ${className}`}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-ds-xs font-body text-ds-text-muted uppercase tracking-ds-wider select-none"
        >
          {label}
        </label>
      )}

      {/* Wrapper gives us a stacking context for the chevron overlay */}
      <div className="relative">
        <select
          id={selectId}
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={!label ? ariaLabel : undefined}
          className={`
            w-full appearance-none
            bg-transparent
            font-body text-ds-sm text-ds-text-primary
            pr-8 pl-3 py-2.5
            border border-ds-hairline
            rounded-[2px]
            transition-colors duration-ds-normal
            hover:border-ds-text-muted
            focus:outline-none focus:border-ds-stamp focus:ring-1 focus:ring-ds-stamp
            disabled:opacity-50 disabled:cursor-not-allowed
            cursor-pointer
          `}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="py-2 px-3 text-ds-sm">
              {opt.label}
            </option>
          ))}
        </select>

        {/* Custom chevron — pointer-events-none so clicks pass through to select */}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-text-muted pointer-events-none"
        />
      </div>
    </div>
  );
}
