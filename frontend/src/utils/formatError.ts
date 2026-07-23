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
 * Converts a raw error message into text suitable for UI display.
 * @param message - Raw error string from API or caught exception
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

  // No code (or a code from an endpoint that doesn't classify DB errors) —
  // this is either a backend-unreachable network failure, or a message that
  // already reads fine as-is (validation/business errors from any other code).
  if (BACKEND_UNREACHABLE_PATTERN.test(trimmed)) {
    return 'Could not reach the server. Ensure the backend is running on port 3000.';
  }

  return trimmed;
}
