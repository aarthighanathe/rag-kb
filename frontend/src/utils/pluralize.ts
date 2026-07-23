/**
 * @file pluralize.ts
 * @description Tiny count-aware pluralization helper for UI copy.
 * @author [Author Placeholder]
 * @created 2026-07-17
 */

/**
 * Returns `${count} ${singular}` or `${count} ${plural ?? singular + 's'}` depending on count.
 * @param count - The quantity being described
 * @param singular - Singular form of the noun
 * @param plural - Optional irregular plural form (defaults to singular + 's')
 * @returns Formatted "count noun" string
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}
