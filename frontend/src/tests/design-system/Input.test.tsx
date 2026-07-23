/**
 * @file Input.test.tsx
 * @description Unit tests for the Input design-system component.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../../design-system/components/Input';

describe('Input', () => {
  it('renders without crashing', () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders with label', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders helper text', () => {
    render(<Input helperText="We will never share your email" />);
    expect(screen.getByText('We will never share your email')).toBeInTheDocument();
  });

  it('renders error message and sets aria-invalid', () => {
    render(<Input errorMessage="This field is required" />);
    expect(screen.getByRole('alert')).toHaveTextContent('This field is required');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('error message overrides helper text', () => {
    render(<Input helperText="helper" errorMessage="error" />);
    expect(screen.queryByText('helper')).not.toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('shows character count when showCharCount + maxLength', () => {
    render(<Input showCharCount maxLength={50} value="hello" onChange={() => {}} />);
    expect(screen.getByText('5/50')).toBeInTheDocument();
  });

  it('fires onChange when user types', async () => {
    const handler = vi.fn();
    render(<Input onChange={handler} />);
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('renders clear button and fires onClear', async () => {
    const onClear = vi.fn();
    render(<Input clearable onClear={onClear} value="some text" onChange={() => {}} />);
    const clearBtn = screen.getByRole('button', { name: 'Clear input' });
    await userEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('does not render clear button when value is empty', () => {
    render(<Input clearable value="" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear input' })).not.toBeInTheDocument();
  });

  it('is disabled and not interactive', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
