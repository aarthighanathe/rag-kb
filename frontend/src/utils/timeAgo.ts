/**
 * @file timeAgo.ts
 * @description Converts an ISO timestamp to a human-readable relative time string.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Converts an ISO timestamp to a human-readable relative time string.
 * @param isoString - ISO 8601 timestamp
 * @returns Relative time string: 'just now', '5m', '2h', '3d', '2w', or '' if invalid
 */
export function timeAgo(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const diff = now - date.getTime();

  // Future dates or very recent
  if (diff < 0 || diff < SECOND * 30) return 'just now';
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  return `${Math.floor(diff / WEEK)}w`;
}
