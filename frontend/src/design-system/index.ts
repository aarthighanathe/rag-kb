/**
 * @file index.ts
 * @description Design system barrel export — re-exports all components, hooks, and tokens.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

// ── Tokens ──────────────────────────────────────────────────────────────────
export * from './tokens';

// ── Components ──────────────────────────────────────────────────────────────
export { Button }           from './components/Button';
export type { ButtonProps, ButtonVariant as ButtonVariantType, ButtonSize } from './components/Button';

export { Input }            from './components/Input';
export type { InputProps, InputVariant } from './components/Input';

export { Badge }            from './components/Badge';
export type { BadgeProps, BadgeVariant, BadgeSize } from './components/Badge';

export { FileDropzone }     from './components/FileDropzone';
export type { FileDropzoneProps, FileEntry } from './components/FileDropzone';

export { CitationChip }     from './components/CitationChip';
export type { CitationChipProps } from './components/CitationChip';

export { ChatMessage }      from './components/ChatMessage';
export type { ChatMessageProps, ChatCitation } from './components/ChatMessage';

export { IndexCard }        from './components/IndexCard';
export type { IndexCardProps } from './components/IndexCard';

export { StreamingCursor }  from './components/StreamingCursor';
export type { StreamingCursorProps } from './components/StreamingCursor';

export { ToastItem, ToastContainer } from './components/Toast';
export type { ToastProps, ToastContainerProps } from './components/Toast';

export { useToast }         from './components/useToast';
export type { Toast, ToastVariant, ToastOptions, UseToastReturn } from './components/useToast';

export { LoadingSpinner }   from './components/LoadingSpinner';
export type { LoadingSpinnerProps, SpinnerSize, SpinnerColor } from './components/LoadingSpinner';

export { Modal }            from './components/Modal';
export type { ModalProps }  from './components/Modal';

export { EmptyState }       from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { Select }           from './components/Select';
export type { SelectProps, SelectOption } from './components/Select';

export { AppHeader }        from './components/AppHeader';
