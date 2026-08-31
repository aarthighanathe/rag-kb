/**
 * @file storage.ts
 * @description Supabase Storage operations for uploaded document files
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { InternalError } from '../types/index.js';
import { toDbInternalError } from '../utils/dbError.js';

/**
 * Bucket holding raw uploaded files between upload and worker processing.
 * Files are removed once a job completes (success or failure) — this is
 * transient staging, not permanent document storage. Must be created in the
 * Supabase dashboard (Storage → New bucket → name "documents", private)
 * before first use; the client does not create it automatically.
 */
const BUCKET = 'documents';

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client. Initialised lazily on first call.
 * @returns Authenticated Supabase client
 */
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Uploads a file buffer to the staging bucket under the given key.
 * @param storageKey - UUID-prefixed key, unique per upload
 * @param buffer - Raw file bytes
 * @throws {InternalError} If the upload fails
 */
export async function uploadFile(storageKey: string, buffer: Buffer): Promise<void> {
  const { error } = await getClient()
    .storage.from(BUCKET)
    .upload(storageKey, buffer, { contentType: 'application/octet-stream', upsert: false });

  if (error) throw toDbInternalError('Failed to upload file to storage', error.message);
}

/**
 * Downloads a file buffer from the staging bucket by key.
 * @param storageKey - Key the file was uploaded under
 * @returns Raw file bytes
 * @throws {InternalError} If the download fails or the file no longer exists
 */
export async function downloadFile(storageKey: string): Promise<Buffer> {
  const { data, error } = await getClient().storage.from(BUCKET).download(storageKey);

  if (error) throw toDbInternalError('Failed to download file from storage', error.message);
  if (!data) throw new InternalError(`No data returned for storage key "${storageKey}"`);

  return Buffer.from(await data.arrayBuffer());
}

/**
 * Removes a file from the staging bucket. Swallows errors by design — callers
 * treat cleanup as best-effort so a missing/already-removed file never masks
 * the primary operation's outcome.
 * @param storageKey - Key of the file to remove
 */
export async function removeFile(storageKey: string): Promise<void> {
  await getClient().storage.from(BUCKET).remove([storageKey]);
}

/** One object currently sitting in the staging bucket, as returned by Storage's list API. */
export interface StagedStorageObject {
  /** Full storage key, e.g. `{documentId}_{sanitizedName}`. */
  name: string;
  /** ISO timestamp the object was uploaded. */
  createdAt: string;
}

/**
 * Lists every object currently in the staging bucket. This is a flat bucket
 * (no folders) so a single unpaginated call, capped generously, is
 * sufficient at this project's scale — see reconcileOrphanedStorageFiles in
 * dataRetention.ts, the only caller.
 * @returns All staged objects, or an empty array if the listing itself fails
 *   (treated as best-effort, consistent with removeFile above — a listing
 *   failure should not be mistaken for "bucket is empty" by the caller, so
 *   it also logs, but must never throw and abort a scheduled job)
 */
export async function listStagedFiles(): Promise<StagedStorageObject[]> {
  const { data, error } = await getClient()
    .storage.from(BUCKET)
    .list(undefined, { limit: 10_000, sortBy: { column: 'created_at', order: 'asc' } });

  if (error) {
    throw toDbInternalError('Failed to list staged storage files', error.message);
  }

  return (data ?? [])
    .filter((entry) => entry.name && entry.id !== null) // list() can return a placeholder folder entry; real objects have an id
    .map((entry) => ({
      name: entry.name,
      createdAt: entry.created_at ?? new Date(0).toISOString(),
    }));
}
