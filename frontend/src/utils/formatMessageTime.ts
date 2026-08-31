/**
 * @file formatMessageTime.ts
 * @description Formats a chat message's ISO timestamp into a short localized
 *   HH:MM string — shared by AssistantMessage and ChatMessage, which
 *   previously each carried an identical independent copy.
 * @author [Author Placeholder]
 * @created 2026-08-31
 */

/**
 * Formats an ISO timestamp as a short localized time (e.g. "3:45 PM").
 * @param iso - ISO 8601 timestamp string, or undefined
 * @returns Localized HH:MM string, or '' if `iso` is missing/invalid
 */
export function formatMessageTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
