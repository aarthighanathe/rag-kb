/**
 * @file dbError.ts
 * @description Maps low-level Supabase/network errors to user-facing InternalError messages.
 * @author [Author Placeholder]
 * @created 2026-06-30
 */

import { InternalError } from '../types/index.js';

/** Patterns indicating the database client could not reach Supabase. */
const CONNECTIVITY_PATTERN =
  /typeerror:\s*fetch failed|fetch failed|econnrefused|enotfound|getaddrinfo|network request failed|socket hang up/i;

/** PostgREST error when tables have not been migrated yet. */
const MISSING_TABLE_PATTERN =
  /could not find the table|relation .* does not exist|schema cache/i;

/**
 * Machine-readable sub-codes for InternalError's otherwise-generic envelope
 * code, distinguishing this module's three outcomes for clients (e.g.
 * formatUserFacingError) that need to react differently to each without
 * re-parsing the human-readable message.
 */
export enum DbErrorCode {
  CONNECTIVITY = 'DB_CONNECTIVITY',
  SCHEMA_NOT_MIGRATED = 'DB_SCHEMA_NOT_MIGRATED',
  GENERIC = 'DB_GENERIC',
}

/**
 * Converts a Supabase client error into an InternalError with a readable message.
 * Connectivity failures are mapped to a setup hint instead of raw TypeError text.
 * @param context - Short operation label (e.g. "Failed to list documents")
 * @param rawMessage - Original error.message from Supabase or fetch
 * @returns InternalError suitable for the API error envelope
 */
export function toDbInternalError(context: string, rawMessage: string): InternalError {
  if (CONNECTIVITY_PATTERN.test(rawMessage)) {
    return new InternalError(
      'Database service is unavailable. Verify SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env, then restart the server.',
      DbErrorCode.CONNECTIVITY,
    );
  }
  if (MISSING_TABLE_PATTERN.test(rawMessage)) {
    return new InternalError(
      'Database schema is not set up. Run `cd backend && npm run db:migrate`, then restart the backend.',
      DbErrorCode.SCHEMA_NOT_MIGRATED,
    );
  }
  return new InternalError(`${context}: ${rawMessage}`, DbErrorCode.GENERIC);
}
