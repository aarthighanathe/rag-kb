/**
 * @file sanitize.ts
 * @description Input sanitization utilities — called in route handlers before any service logic
 *
 * Threat model:
 *  - sanitizeQueryText  → XSS via stored HTML (A03), prompt injection in LLM context
 *
 * This function is a defence-in-depth layer on top of Zod validation.
 * It does NOT replace schema validation — both must run.
 *
 * Filename sanitization (path traversal, null bytes, double-extension attacks)
 * is handled by `sanitizeFileName` in `utils/fileValidator.ts`, the sole
 * implementation wired into the upload pipeline.
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum length for a user-supplied query string before truncation. */
const MAX_QUERY_LENGTH = 2_000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sanitizes free-text query input before it is passed to the LLM or vector store.
 *
 * Steps:
 *  1. Strip HTML tags — prevents stored XSS if the text is ever echoed back.
 *  2. Remove null bytes — prevent C-string truncation in downstream libraries.
 *  3. Normalize whitespace — collapse runs of spaces/newlines to a single space.
 *  4. Truncate to MAX_QUERY_LENGTH — prevents oversized LLM context injection.
 *
 * Threat: A03 Injection — raw user text could carry `<script>` tags (XSS), SQL fragments
 * (if ever interpolated), or excessively long strings that inflate billing / DoS the LLM.
 *
 * @param text - Raw query text from the user
 * @param maxLength - Maximum allowed length (default: 2000)
 * @returns Sanitized, whitespace-normalized, truncated string
 */
export function sanitizeQueryText(text: string, maxLength: number = MAX_QUERY_LENGTH): string {
  return text
    .replace(/<[^>]*>/g, '') // strip HTML/XML tags
    .replace(/\0/g, '') // strip null bytes
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim()
    .slice(0, maxLength);
}
