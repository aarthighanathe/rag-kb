/**
 * @file formatError.ts
 * @description Converts raw API/network error strings into user-facing messages.
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

/**
 * Backend `error.code` values (see backend/src/utils/dbError.ts's DbErrorCode)
 * that indicate a database-layer problem rather than a generic internal error.
 * Switching on these avoids re-deriving "connectivity vs. schema vs. generic"
 * by regexing the message text a second time — the backend already did that
 * classification once and threads the result through as a machine-readable code.
 */
const DB_CONNECTIVITY_CODE = 'DB_CONNECTIVITY';
const DB_SCHEMA_NOT_MIGRATED_CODE = 'DB_SCHEMA_NOT_MIGRATED';

/**
 * Patterns for connectivity failures where the backend itself never responded
 * (the fetch to our own API failed) — there is no server-produced `.code` for
 * this case, since no response body was ever received. This is the one
 * genuinely code-less case formatUserFacingError still needs to detect from
 * the raw browser/runtime error message.
 */
const BACKEND_UNREACHABLE_PATTERN =
  /typeerror:\s*fetch failed|failed to fetch|networkerror when attempting to fetch|load failed|econnrefused|enotfound|network error|getaddrinfo|socket hang up/i;

/**
 * Detects whether a raw error message describes the browser's `fetch` failing
 * before any response was received — i.e. the backend itself is unreachable,
 * as opposed to the backend responding with an error. There is no server
 * `.code` for this case since no response body was ever received, so the raw
 * message is the only signal available.
 * @param message - Raw error message to test
 * @returns True if the message matches a known network-unreachable pattern
 */
export function isBackendUnreachable(message: string): boolean {
  return BACKEND_UNREACHABLE_PATTERN.test(message.trim());
}

/**
 * Converts a raw error message into text suitable for UI display.
 * Callers are expected to have already established that `message` is safe to
 * show — either it came from a server response, or `isBackendUnreachable`
 * matched it. This function only handles the DB-error-code special cases and
 * the network-unreachable rewrite; it does not decide whether a message
 * should be shown at all.
 * @param message - Raw error string from API or a confirmed network failure
 * @param code - Machine-readable error code from the API envelope, when available
 *   (TypedApiError.code) — preferred over message-sniffing when present
 * @returns User-facing error message — never "[object Object]" or bare TypeError text
 */
export function formatUserFacingError(message: string, code?: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'An unexpected error occurred. Please try again.';
  }

  if (code === DB_SCHEMA_NOT_MIGRATED_CODE) {
    return trimmed;
  }
  if (code === DB_CONNECTIVITY_CODE) {
    return 'Database service is unavailable. Verify Supabase is configured in backend/.env and restart the server.';
  }

  if (isBackendUnreachable(trimmed)) {
    return 'Could not reach the server. Ensure the backend is running on port 3000.';
  }

  return trimmed;
}
