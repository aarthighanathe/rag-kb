/**
 * @file vectorStore.ts
 * @description Supabase pgvector operations — upsert chunks, similarity search, document CRUD
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import {
  InternalError,
  NotFoundError,
  type DocumentRecord,
  type RetrievedChunk,
  type DocumentStatus,
  type FileType,
  type InsertQueryLog,
  type QueryFeedback,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { toDbInternalError } from '../utils/dbError.js';
import { FILE_TYPE_TO_MIME } from '../utils/fileValidator.js';
import { throwIfAborted } from '../queues/cancellation.js';
import type { TextChunk } from './chunker.js';

/** Supabase table names. */
const TABLES = {
  DOCUMENTS: 'documents',
  CHUNKS: 'document_chunks',
  QUERY_LOGS: 'query_logs',
  AUDIT_LOGS: 'audit_logs',
} as const;

/** RPC function name for pgvector similarity search (defined in 001_initial.sql). */
const MATCH_CHUNKS_FN = 'match_chunks';

/** RPC function name for pg_trgm keyword/fuzzy search (defined in 004_keyword_search.sql). */
const MATCH_CHUNKS_KEYWORD_FN = 'match_chunks_keyword';

/** Raw row shape returned from the `documents` table (001_initial.sql). */
interface DbDocumentRow {
  id: string;
  filename: string;
  original_name: string;
  file_type: FileType;
  file_size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  tags?: string[] | null;
}

/**
 * Maps a Supabase documents row to the API DocumentRecord shape.
 * @param row - Raw database row
 * @returns DocumentRecord for API consumers
 */
function mapDocumentRow(row: DbDocumentRow): DocumentRecord {
  const result: DocumentRecord = {
    id: row.id,
    filename: row.original_name,
    mime_type: FILE_TYPE_TO_MIME[row.file_type],
    size_bytes: row.file_size_bytes,
    status: row.status,
    chunk_count: row.chunk_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags: row.tags ?? [],
  };
  if (row.error_message !== null && row.error_message !== undefined) {
    result.error_message = row.error_message as string;
  }
  return result;
}

/**
 * Translates the result of an owner-scoped mutation (`.eq('id', id).eq('user_id',
 * userId)` on `.update()`/`.delete()` with `{ count: 'exact' }`) into the shared
 * IDOR-prevention outcome: a mismatched owner or nonexistent document both
 * surface as the same 404, since `count === 0` covers both cases identically —
 * an attacker probing another user's document ID can never distinguish "not
 * yours" from "doesn't exist". Used by setDocumentTags/deleteDocument, which
 * differ only in which Supabase method (`.update()`/`.delete()`) built the
 * query and the operation name in the error message.
 * @param result - The `{ error, count }` result of the owner-scoped mutation
 * @param documentId - UUID of the document being mutated, for the error message
 * @param operation - Human-readable operation name (e.g. "set document tags"), for the error message
 * @throws {NotFoundError} If `count` is 0 (no row matched id + user_id)
 * @throws {InternalError} On database error
 */
function assertOwnedMutationSucceeded(
  result: { error: { message: string } | null; count: number | null },
  documentId: string,
  operation: string,
): void {
  if (result.error) throw toDbInternalError(`Failed to ${operation}`, result.error.message);
  if (result.count === 0) throw new NotFoundError(`Document ${documentId} not found`);
}

/**
 * Verifies a document exists and is owned by `userId`, throwing the same
 * IDOR-prevention 404 as the mutation path above when it isn't — for callers
 * that need to confirm ownership as a standalone pre-check before a separate
 * follow-up query (e.g. `getChunkQualityStats` querying `document_chunks`
 * next), rather than scoping the ownership check into their own primary
 * query directly (as `getDocument` does, since fetching the row *is* its
 * primary query).
 * @param documentId - UUID of the document to verify
 * @param userId - Must match the document's owner
 * @throws {NotFoundError} If no document with this ID is owned by userId
 * @throws {InternalError} On database error
 */
async function assertDocumentOwnership(documentId: string, userId: string): Promise<void> {
  const { data, error } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id')
    .eq('id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw toDbInternalError('Failed to verify document ownership', error.message);
  if (!data) throw new NotFoundError(`Document ${documentId} not found`);
}

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client. Initialised lazily on first call.
 * Exported so other modules needing direct Supabase access (dataRetention.ts,
 * backupService.ts) reuse this one connection instead of each constructing
 * their own separate client against the same project.
 * @returns Authenticated Supabase client
 */
export function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Inserts a new document record with 'pending' status.
 * @param params - Document metadata to insert, including the owning user's ID
 * @returns The created document record
 * @throws {InternalError} On database error
 */
export async function createDocument(params: {
  id: string;
  filename: string;
  originalName: string;
  fileType: FileType;
  sizeBytes: number;
  userId: string;
  contentHash?: string;
}): Promise<DocumentRecord> {
  // Explicit type annotation prevents no-unsafe-assignment from the generic Supabase return
  const result = await getClient()
    .from(TABLES.DOCUMENTS)
    .insert({
      id: params.id,
      filename: params.filename,
      original_name: params.originalName,
      file_type: params.fileType,
      file_size_bytes: params.sizeBytes,
      status: 'pending' as DocumentStatus,
      chunk_count: 0,
      user_id: params.userId,
      content_hash: params.contentHash ?? null,
    })
    .select()
    .single();
  const { data, error } = result as {
    data: DbDocumentRow | null;
    error: { message: string } | null;
  };

  if (error) throw toDbInternalError('Failed to create document', error.message);
  return mapDocumentRow(data as DbDocumentRow);
}

/** A prior document with the same content hash, surfaced to the uploader as a possible duplicate. */
export interface DuplicateDocumentMatch {
  id: string;
  filename: string;
  status: DocumentStatus;
  createdAt: string;
}

/**
 * Looks up an existing document owned by `userId` with the same content hash,
 * for surfacing a "you already uploaded this" notice at upload time. Scoped
 * to the uploader's own documents only — a match against another user's
 * document is never revealed (see migration 009's index comment for why a
 * cross-user check would itself be an information leak).
 * @param userId - Owner to scope the lookup to
 * @param contentHash - SHA-256 hex digest of the raw uploaded file bytes
 * @returns The existing document if a byte-identical prior upload exists, else null
 * @throws {InternalError} On database error
 */
export async function findDocumentByHash(
  userId: string,
  contentHash: string,
): Promise<DuplicateDocumentMatch | null> {
  const { data, error } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id, original_name, status, created_at')
    .eq('user_id', userId)
    .eq('content_hash', contentHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw toDbInternalError('Failed to look up document by content hash', error.message);
  if (!data) return null;

  const row = data as {
    id: string;
    original_name: string;
    status: DocumentStatus;
    created_at: string;
  };
  return { id: row.id, filename: row.original_name, status: row.status, createdAt: row.created_at };
}

/**
 * Updates the status (and optionally error message) of a document.
 * @param documentId - UUID of the document
 * @param status - New document status
 * @param errorMessage - Optional error message for 'failed' status
 * @param signal - Optional cancellation signal, checked immediately before the
 *   write. A superseded job attempt must never write a terminal status that
 *   could clobber whatever a newer attempt/retry has already produced.
 * @throws {InternalError} On database error
 * @throws {JobCancelledError} If `signal` is already aborted
 */
export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  errorMessage?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) throwIfAborted(signal, 'updateDocumentStatus', { documentId, status });

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (errorMessage !== undefined) update['error_message'] = errorMessage;

  const { error } = await getClient().from(TABLES.DOCUMENTS).update(update).eq('id', documentId);

  if (error) throw toDbInternalError('Failed to update document status', error.message);
}

/**
 * Updates the chunk count after successful processing.
 * @param documentId - UUID of the document
 * @param chunkCount - Number of chunks stored
 * @param signal - Optional cancellation signal, checked immediately before the
 *   write (see `updateDocumentStatus` for why this matters under retries)
 * @throws {InternalError} On database error
 * @throws {JobCancelledError} If `signal` is already aborted
 */
export async function updateChunkCount(
  documentId: string,
  chunkCount: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) throwIfAborted(signal, 'updateChunkCount', { documentId, chunkCount });

  const { error } = await getClient()
    .from(TABLES.DOCUMENTS)
    .update({ chunk_count: chunkCount, updated_at: new Date().toISOString() })
    .eq('id', documentId);

  if (error) throw toDbInternalError('Failed to update chunk count', error.message);
}

/** Cap on auto-derived tags — a handful of headings is useful filtering, a whole table of contents is not. */
const MAX_AUTO_TAGS = 5;

/**
 * Derives a small set of tags from a document's chunk section headings —
 * no extra LLM call, purely reusing the section metadata section-aware
 * chunking (chunker.ts) already computes during normal processing. A
 * document with no detected structure (no headings) yields an empty array;
 * callers should treat that as "nothing to auto-tag," not an error.
 * @param sections - Section headings observed across a document's chunks (duplicates and undefined allowed)
 * @returns Up to MAX_AUTO_TAGS distinct, trimmed tag strings, in first-seen order
 */
export function deriveAutoTags(sections: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const raw of sections) {
    const section = raw?.trim();
    if (section) seen.add(section);
    if (seen.size >= MAX_AUTO_TAGS) break;
  }
  return [...seen];
}

/**
 * Sets a document's auto-derived tags after processing completes. Overwrites
 * any existing tags — called once per successful processing run, so there's
 * no prior auto-tag state to merge with (a user's own manually-added tags
 * are managed separately via setDocumentTags/PATCH, not touched here).
 * @param documentId - UUID of the document
 * @param tags - Tags to set (already deduped/capped by the caller — see deriveAutoTags)
 * @param signal - Optional cancellation signal, same convention as updateChunkCount
 * @throws {InternalError} On database error
 * @throws {JobCancelledError} If `signal` is already aborted
 */
export async function setAutoTags(
  documentId: string,
  tags: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal) throwIfAborted(signal, 'setAutoTags', { documentId, tagCount: tags.length });
  if (tags.length === 0) return;

  const { error } = await getClient().from(TABLES.DOCUMENTS).update({ tags }).eq('id', documentId);

  if (error) throw toDbInternalError('Failed to set document auto-tags', error.message);
}

/**
 * Replaces a document's tags (both auto-derived and manual are the same
 * column — once a user edits tags, that edit simply becomes the new value).
 * Scoped to the owner in the same query as the update, matching the
 * getDocument/deleteDocument IDOR-prevention pattern.
 * @param documentId - UUID of the document
 * @param userId - Must match the document's owner
 * @param tags - New tag list (caller is responsible for validation — length/count caps live in the Zod schema)
 * @throws {NotFoundError} If no document with this ID is owned by userId
 * @throws {InternalError} On database error
 */
export async function setDocumentTags(
  documentId: string,
  userId: string,
  tags: string[],
): Promise<void> {
  const result = await getClient()
    .from(TABLES.DOCUMENTS)
    .update({ tags }, { count: 'exact' })
    .eq('id', documentId)
    .eq('user_id', userId);

  assertOwnedMutationSucceeded(result, documentId, 'set document tags');
}

/**
 * Inserts embedded text chunks for a document into the vector store.
 * Uses upsert to allow idempotent reprocessing — the `UNIQUE(document_id,
 * chunk_index)` constraint remains the source of idempotency at the DB level;
 * the `signal` check below is defense in depth to stop the write from being
 * attempted at all once an attempt is known to be superseded, not a
 * replacement for that constraint.
 * @param documentId - Parent document UUID
 * @param chunks - Parsed text chunks with content and metadata
 * @param embeddings - Corresponding embedding vectors (must match chunks length)
 * @param signal - Optional cancellation signal, checked immediately before the
 *   write (see `updateDocumentStatus` for why this matters under retries)
 * @throws {InternalError} On database error or length mismatch
 * @throws {JobCancelledError} If `signal` is already aborted
 */
export async function upsertChunks(
  documentId: string,
  chunks: TextChunk[],
  embeddings: number[][],
  signal?: AbortSignal,
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new InternalError('Chunks and embeddings arrays must have the same length');
  }

  if (signal) throwIfAborted(signal, 'upsertChunks', { documentId, chunkCount: chunks.length });

  const rows = chunks.map((chunk, i) => ({
    document_id: documentId,
    content: chunk.content,
    embedding: embeddings[i],
    chunk_index: i,
    metadata: chunk.metadata,
    token_count: chunk.tokenCount,
  }));

  const { error } = await getClient().from(TABLES.CHUNKS).upsert(rows, {
    onConflict: 'document_id,chunk_index',
  });

  if (error) throw toDbInternalError('Failed to upsert chunks', error.message);
  logger.info('Chunks upserted', { documentId, count: rows.length });
}

/**
 * DB-row shape returned by both match_chunks RPCs — identical to RetrievedChunk
 * except `source` is absent (it's added by the caller after validation, not
 * stored in the database). The type predicate below narrows to this type so
 * the predicate is honest: it only asserts what the row actually contains.
 */
type DbRetrievedChunk = Omit<RetrievedChunk, 'source'>;

/**
 * Runtime shape check for one match_chunks RPC row, mirroring embedder.ts's
 * isEmbeddingArrayShape guard for the analogous external-response boundary.
 * A row missing/null on any required field would otherwise flow straight into
 * extractCitations/buildContextString and produce a corrupted citation or a
 * broken prompt with no error raised anywhere.
 * @param row - A single row from the match_chunks RPC response
 * @returns true if the row has all required DbRetrievedChunk fields with correct types
 */
function isValidRetrievedChunk(row: unknown): row is DbRetrievedChunk {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['document_id'] === 'string' &&
    typeof r['content'] === 'string' &&
    typeof r['similarity'] === 'number' &&
    typeof r['filename'] === 'string' &&
    typeof r['metadata'] === 'object' &&
    r['metadata'] !== null
  );
}

/**
 * Performs cosine similarity search against stored chunk embeddings.
 * Delegates to the match_document_chunks Postgres RPC function.
 * @param queryEmbedding - 384-dim query vector
 * @param topK - Number of results to return
 * @param userId - Restricts the search to documents owned by this user
 * @param documentIds - Optional filter to search within specific documents
 * @param similarityThreshold - Optional minimum cosine similarity; when omitted (undefined),
 *   falls through to the SQL function's own default. In practice `QueryRequestSchema`
 *   (query.schema.ts) gives this a Zod `.default(0)`, so requests arriving via
 *   POST /api/query always pass an explicit 0 here and never actually hit the SQL
 *   default — only a direct, non-HTTP caller of this function could reach it.
 * @param relativeFloorGap - Optional relative floor: drops candidates trailing the batch's
 *   own top match by more than this gap (defaults to the SQL function's default, 0.15;
 *   pass 0 or a negative number to disable)
 * @returns Array of retrieved chunks sorted by similarity descending
 * @throws {InternalError} On RPC error
 */
export async function similaritySearch(
  queryEmbedding: number[],
  topK: number,
  userId: string,
  documentIds?: string[],
  similarityThreshold?: number,
  relativeFloorGap?: number,
): Promise<RetrievedChunk[]> {
  const params: Record<string, unknown> = {
    query_embedding: queryEmbedding,
    match_count: topK,
    p_user_id: userId,
  };
  if (documentIds && documentIds.length > 0) {
    params['filter_document_ids'] = documentIds;
  }
  if (similarityThreshold !== undefined) {
    params['similarity_threshold'] = similarityThreshold;
  }
  if (relativeFloorGap !== undefined) {
    params['relative_floor_gap'] = relativeFloorGap;
  }

  // Explicit type annotation prevents no-unsafe-assignment from the generic Supabase return
  const rpcResult = await getClient().rpc(MATCH_CHUNKS_FN, params);
  const { data, error } = rpcResult as {
    data: unknown[] | null;
    error: { message: string } | null;
  };

  if (error) throw toDbInternalError('Vector search failed', error.message);
  return filterValidRetrievedChunks(data, MATCH_CHUNKS_FN).map((c) => ({
    ...c,
    source: 'vector' as const,
  }));
}

/**
 * Runtime-validates and unwraps a match_chunks-shaped RPC response, dropping
 * (and logging) any malformed rows rather than letting them flow downstream.
 * Shared by similaritySearch and keywordSearch since both RPCs return the
 * same row shape. Returns DbRetrievedChunk (no `source` field) — callers
 * must add a `source` tag before returning to their consumers.
 * @param data - Raw RPC response rows, or null
 * @param fnName - RPC function name, for log context
 * @returns Validated rows only
 */
function filterValidRetrievedChunks(data: unknown[] | null, fnName: string): DbRetrievedChunk[] {
  if (!data) return [];

  const validRows: DbRetrievedChunk[] = [];
  let droppedCount = 0;
  for (const row of data) {
    if (isValidRetrievedChunk(row)) {
      validRows.push(row);
    } else {
      droppedCount++;
    }
  }
  if (droppedCount > 0) {
    logger.warn(`Dropped malformed rows from ${fnName} RPC response`, {
      droppedCount,
      totalCount: data.length,
    });
  }
  return validRows;
}

/**
 * Performs fuzzy keyword search against stored chunk content via pg_trgm's
 * similarity() function. Delegates to the match_chunks_keyword Postgres RPC
 * (004_keyword_search.sql). Weak spot for dense vector search — exact terms
 * like product codes, acronyms, and proper nouns — is this function's strong
 * spot, and vice versa; see hybridSearch for how the two are combined.
 * @param queryText - Raw (sanitised) query text — not an embedding
 * @param topK - Number of results to return
 * @param userId - Restricts the search to documents owned by this user
 * @param documentIds - Optional filter to search within specific documents
 * @param keywordThreshold - Optional minimum trigram similarity (defaults to the SQL function's default, 0.15)
 * @returns Array of retrieved chunks sorted by trigram similarity descending
 * @throws {InternalError} On RPC error
 */
export async function keywordSearch(
  queryText: string,
  topK: number,
  userId: string,
  documentIds?: string[],
  keywordThreshold?: number,
): Promise<RetrievedChunk[]> {
  const params: Record<string, unknown> = {
    query_text: queryText,
    match_count: topK,
    p_user_id: userId,
  };
  if (documentIds && documentIds.length > 0) {
    params['filter_document_ids'] = documentIds;
  }
  if (keywordThreshold !== undefined) {
    params['keyword_threshold'] = keywordThreshold;
  }

  const rpcResult = await getClient().rpc(MATCH_CHUNKS_KEYWORD_FN, params);
  const { data, error } = rpcResult as {
    data: unknown[] | null;
    error: { message: string } | null;
  };

  if (error) throw toDbInternalError('Keyword search failed', error.message);
  return filterValidRetrievedChunks(data, MATCH_CHUNKS_KEYWORD_FN).map((c) => ({
    ...c,
    source: 'keyword' as const,
  }));
}

/**
 * Runs vector similarity search and keyword (pg_trgm) search in parallel and
 * merges the results, deduplicating by chunk id and keeping the higher of
 * the two scores for any chunk both methods found. This compensates for a
 * known weakness of the dense embedding model (all-MiniLM-L6-v2): it embeds
 * meaning, not exact tokens, so queries hinging on a specific product code,
 * acronym, or proper noun can score poorly on vector similarity alone even
 * though the exact term appears verbatim in a chunk.
 *
 * The merged, deduplicated set is re-sorted by score descending and capped
 * to topK — so a chunk found by both methods isn't double-counted, and the
 * final result never exceeds what the caller asked for.
 * @param queryEmbedding - 384-dim query vector
 * @param queryText - Raw (sanitised) query text, for the keyword search leg
 * @param topK - Maximum number of results to return after merging
 * @param userId - Restricts the search to documents owned by this user
 * @param documentIds - Optional filter to search within specific documents
 * @param similarityThreshold - Optional minimum cosine similarity for the vector leg
 * @param relativeFloorGap - Optional relative floor for the vector leg (see similaritySearch)
 * @param keywordThreshold - Optional minimum trigram similarity for the keyword leg
 * @returns Merged, deduplicated, re-ranked chunks capped at topK
 * @throws {InternalError} If either underlying RPC errors
 */
export async function hybridSearch(
  queryEmbedding: number[],
  queryText: string,
  topK: number,
  userId: string,
  documentIds?: string[],
  similarityThreshold?: number,
  relativeFloorGap?: number,
  keywordThreshold?: number,
): Promise<RetrievedChunk[]> {
  // match_count is intentionally topK (not e.g. 2*topK) on each leg — each
  // individual search is already ranked internally, so asking each for at
  // least topK candidates guarantees the merged set can still fill topK
  // even in the case where the two result sets don't overlap at all.
  //
  // Promise.allSettled (not Promise.all) so a keyword-search failure (e.g.
  // pg_trgm extension not yet installed in the current environment, or a
  // transient error on that leg) degrades gracefully to vector-only results
  // rather than failing the entire query — keyword search is an enhancement,
  // not a hard dependency.
  const [vectorResult, keywordResult] = await Promise.allSettled([
    similaritySearch(
      queryEmbedding,
      topK,
      userId,
      documentIds,
      similarityThreshold,
      relativeFloorGap,
    ),
    keywordSearch(queryText, topK, userId, documentIds, keywordThreshold),
  ]);

  if (vectorResult.status === 'rejected') {
    // Vector search is the primary leg — its failure is a hard error.
    throw vectorResult.reason;
  }

  const vectorRows = vectorResult.value;
  let keywordRows: RetrievedChunk[] = [];

  if (keywordResult.status === 'rejected') {
    logger.warn('Keyword search failed — falling back to vector-only results', {
      error:
        keywordResult.reason instanceof Error
          ? keywordResult.reason.message
          : String(keywordResult.reason),
    });
  } else {
    keywordRows = keywordResult.value;
  }

  const merged = new Map<string, RetrievedChunk>();
  for (const row of [...vectorRows, ...keywordRows]) {
    const existing = merged.get(row.id);
    if (!existing || row.similarity > existing.similarity) {
      merged.set(row.id, row);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Retrieves a single document record by ID, scoped to its owner.
 * Filtering by user_id at the query level (rather than checking after fetch)
 * means a mismatched owner surfaces as the same 404 as a non-existent document —
 * this prevents an IDOR attacker from distinguishing "not mine" from "doesn't exist".
 * @param documentId - UUID of the document
 * @param userId - Must match the document's owner
 * @returns Document record
 * @throws {NotFoundError} If no document with this ID is owned by userId
 * @throws {InternalError} On database error
 */
export async function getDocument(documentId: string, userId: string): Promise<DocumentRecord> {
  // Explicit type annotation prevents no-unsafe-assignment from the generic Supabase return
  const getResult = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('*')
    .eq('id', documentId)
    .eq('user_id', userId)
    .single();
  const { data, error } = getResult as {
    data: DbDocumentRow | null;
    error: { code?: string; message: string } | null;
  };

  if (error?.code === 'PGRST116') throw new NotFoundError(`Document ${documentId} not found`);
  if (error) throw toDbInternalError('Failed to fetch document', error.message);
  return mapDocumentRow(data as DbDocumentRow);
}

/**
 * Chunk quality statistics for a processed document.
 */
export interface ChunkQualityStats {
  totalChunks: number;
  avgTokenCount: number;
  minTokenCount: number;
  maxTokenCount: number;
  /** Chunks with < 50 tokens — too short to be useful */
  shortChunkCount: number;
  /** Chunks with > 600 tokens — may exceed context well */
  longChunkCount: number;
  /** Quality grade: 'good' | 'fair' | 'poor' */
  grade: 'good' | 'fair' | 'poor';
}

/**
 * Computes chunk quality statistics for a document.
 * Queries document_chunks for token_count values, scoped to the document's
 * owner — mirrors the ownership check in getDocument/deleteDocument so this
 * function is safe to call directly without relying on a caller to have
 * already verified ownership.
 * @param documentId - Document UUID
 * @param userId - Must match the document's owner
 * @returns Quality stats or null if no chunks found
 * @throws {NotFoundError} If no document with this ID is owned by userId
 */
export async function getChunkQualityStats(
  documentId: string,
  userId: string,
): Promise<ChunkQualityStats | null> {
  await assertDocumentOwnership(documentId, userId);

  const { data, error } = await getClient()
    .from(TABLES.CHUNKS)
    .select('token_count')
    .eq('document_id', documentId);

  if (error) throw toDbInternalError('Failed to fetch chunk stats', error.message);
  const rows = data as Array<{ token_count: number }> | null;
  if (!rows || rows.length === 0) return null;

  const tokenCounts = rows.map((r) => r.token_count ?? 0);
  const totalChunks = tokenCounts.length;
  const avgTokenCount = tokenCounts.reduce((s, t) => s + t, 0) / totalChunks;
  const minTokenCount = Math.min(...tokenCounts);
  const maxTokenCount = Math.max(...tokenCounts);
  const shortChunkCount = tokenCounts.filter((t) => t < 50).length;
  const longChunkCount = tokenCounts.filter((t) => t > 600).length;

  const problematicRatio = (shortChunkCount + longChunkCount) / totalChunks;
  let grade: 'good' | 'fair' | 'poor';
  if (problematicRatio < 0.1) {
    grade = 'good';
  } else if (problematicRatio < 0.3) {
    grade = 'fair';
  } else {
    grade = 'poor';
  }

  return {
    totalChunks,
    avgTokenCount: Math.round(avgTokenCount),
    minTokenCount,
    maxTokenCount,
    shortChunkCount,
    longChunkCount,
    grade,
  };
}

/** Max chunks returned by getDocumentChunkPreviews per call — matches ExpandedRow.tsx's "first N chunks" preview UI, not a full-document dump. */
const MAX_CHUNK_PREVIEWS = 3;

/** Chunk content is truncated to this length in previews — enough to judge chunk quality/relevance without shipping full chunk text (which can be ~2KB) for a UI element that only shows a few lines. */
const CHUNK_PREVIEW_CONTENT_LENGTH = 240;

/** One chunk's preview data, as returned by getDocumentChunkPreviews. */
export interface ChunkPreview {
  id: string;
  chunkIndex: number;
  /** Truncated chunk content — see CHUNK_PREVIEW_CONTENT_LENGTH. */
  contentPreview: string;
  /** True if contentPreview was truncated from the full chunk content. */
  truncated: boolean;
  tokenCount: number | null;
}

/**
 * Returns a preview (truncated content, up to MAX_CHUNK_PREVIEWS chunks) of a
 * document's earliest chunks by chunk_index, for the Documents page's
 * expanded-row chunk preview. Ownership-checked the same way as
 * getChunkQualityStats — safe to call directly without a caller having
 * already verified ownership.
 * @param documentId - Document UUID
 * @param userId - Owner to scope the check to
 * @returns Up to MAX_CHUNK_PREVIEWS chunk previews, ordered by chunk_index ascending
 * @throws {NotFoundError} If the document doesn't exist or isn't owned by userId
 */
export async function getDocumentChunkPreviews(
  documentId: string,
  userId: string,
): Promise<ChunkPreview[]> {
  await assertDocumentOwnership(documentId, userId);

  const { data, error } = await getClient()
    .from(TABLES.CHUNKS)
    .select('id, chunk_index, content, token_count')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true })
    .limit(MAX_CHUNK_PREVIEWS);

  if (error) throw toDbInternalError('Failed to fetch chunk previews', error.message);
  const rows = data as Array<{
    id: string;
    chunk_index: number;
    content: string;
    token_count: number | null;
  }> | null;

  return (rows ?? []).map((row) => {
    const truncated = row.content.length > CHUNK_PREVIEW_CONTENT_LENGTH;
    return {
      id: row.id,
      chunkIndex: row.chunk_index,
      contentPreview: truncated
        ? `${row.content.slice(0, CHUNK_PREVIEW_CONTENT_LENGTH)}…`
        : row.content,
      truncated,
      tokenCount: row.token_count,
    };
  });
}

/** Cap on distinct section headings returned by getSuggestedTopics — enough for a handful of query-suggestion buttons without pulling a document's entire table of contents. */
const MAX_SUGGESTED_TOPICS = 8;

/**
 * Filters a candidate document ID list down to those actually owned by
 * `userId`. Same IDOR-prevention shape as getChunkQualityStats: an ID the
 * caller doesn't own is silently dropped rather than surfacing whether it
 * exists.
 * @param documentIds - Candidate document IDs
 * @param userId - Owner to scope the check to
 * @returns The subset of documentIds actually owned by userId
 * @throws {InternalError} On database error
 */
async function filterOwnedDocumentIds(documentIds: string[], userId: string): Promise<string[]> {
  const { data, error } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id')
    .eq('user_id', userId)
    .in('id', documentIds);

  if (error) throw toDbInternalError('Failed to verify document ownership', error.message);
  return ((data as Array<{ id: string }> | null) ?? []).map((d) => d.id);
}

/**
 * Extracts up to MAX_SUGGESTED_TOPICS distinct, trimmed section headings
 * from a set of chunk rows, in first-seen order.
 * @param rows - Chunk rows with a `metadata.section` field
 * @returns Distinct section headings
 */
function collectDistinctSections(rows: Array<{ metadata: { section?: string } }>): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const section = row.metadata?.section?.trim();
    if (section) seen.add(section);
    if (seen.size >= MAX_SUGGESTED_TOPICS) break;
  }
  return [...seen];
}

/**
 * Returns a small set of distinct section headings drawn from the given
 * documents' chunks, for building content-aware query suggestions (e.g.
 * "Tell me about {heading}") instead of generic hardcoded prompts. Only
 * chunks with a non-null `metadata.section` contribute — populated by the
 * section-aware chunking pass (chunker.ts) for documents with real
 * structure (headings, numbered sections); a plain document with no
 * detected structure contributes nothing, and the caller falls back to
 * generic suggestions in that case.
 * @param documentIds - Documents to draw headings from, deduped by caller if needed
 * @param userId - Restricts to documents owned by this user (IDOR prevention, same pattern as every other per-user lookup)
 * @returns Up to MAX_SUGGESTED_TOPICS distinct section headings, in first-seen order
 * @throws {InternalError} On database error
 */
export async function getSuggestedTopics(documentIds: string[], userId: string): Promise<string[]> {
  if (documentIds.length === 0) return [];

  const ownedIds = await filterOwnedDocumentIds(documentIds, userId);
  if (ownedIds.length === 0) return [];

  const { data, error } = await getClient()
    .from(TABLES.CHUNKS)
    .select('metadata')
    .in('document_id', ownedIds)
    .not('metadata->>section', 'is', null)
    .limit(500); // enough rows to find a handful of distinct headings without scanning a huge document fully

  if (error) throw toDbInternalError('Failed to fetch section headings', error.message);

  return collectDistinctSections((data as Array<{ metadata: { section?: string } }> | null) ?? []);
}

/**
 * Lists documents owned by a user, with optional status filter and pagination.
 * @param page - Page number (1-based)
 * @param limit - Results per page
 * @param status - Optional status filter
 * @param userId - Restricts results to documents owned by this user
 * @returns Paginated list of documents and total count
 * @throws {InternalError} On database error
 */
export async function listDocuments(
  page: number,
  limit: number,
  status: DocumentStatus | undefined,
  userId: string,
): Promise<{ data: DocumentRecord[]; total: number }> {
  let query = getClient()
    .from(TABLES.DOCUMENTS)
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;

  if (error) throw toDbInternalError('Failed to list documents', error.message);
  const rows = (data as DbDocumentRow[] | null) ?? [];
  return { data: rows.map(mapDocumentRow), total: count ?? 0 };
}

/**
 * Inserts an analytics record for a completed RAG query.
 * Append-only — callers should fire-and-forget rather than await on the request path.
 * Returns the inserted row's id so the caller can surface it to the client (e.g. in the
 * SSE `complete` event) as the handle later used by POST /api/query/:queryId/feedback —
 * the pending-query UUID used for the SSE handshake is deleted the moment the stream
 * starts, so it can't be reused as that handle; this row's own id is the only stable
 * reference to a specific query once the stream has completed.
 * @param entry - Query text plus optional retrieval/response analytics fields
 * @returns The UUID of the newly inserted query_logs row
 * @throws {InternalError} On database error
 */
export async function logQuery(entry: InsertQueryLog): Promise<string> {
  const { data, error } = await getClient()
    .from(TABLES.QUERY_LOGS)
    .insert(entry)
    .select('id')
    .single();

  if (error) throw toDbInternalError('Failed to log query', error.message);
  return (data as { id: string }).id;
}

/** Raw row shape returned from a `query_logs` list/search query. */
interface DbQueryLogListRow {
  id: string;
  query_text: string;
  response_preview: string | null;
  latency_ms: number | null;
  feedback: QueryFeedback | null;
  validation_confidence: number | null;
  created_at: string;
}

/**
 * Lists (optionally text-searched) query_logs rows owned by a user, most
 * recent first. Backs conversation search — the durable full history in
 * `query_logs`, as opposed to the 10-entry localStorage cache the frontend
 * also keeps for instant client-side access.
 * @param userId - Restricts results to queries owned by this user
 * @param page - Page number (1-based)
 * @param limit - Results per page
 * @param search - Optional case-insensitive substring match against `query_text`
 * @returns Paginated list of query log rows and total matching count
 * @throws {InternalError} On database error
 */
export async function listQueryLogs(
  userId: string,
  page: number,
  limit: number,
  search?: string,
): Promise<{ data: DbQueryLogListRow[]; total: number }> {
  // Filters are applied before the .order()/.range() pagination modifiers —
  // deliberately not chained after, since .range() is the terminal call in
  // this codebase's convention (it resolves to the response directly once
  // awaited) and a filter chained after it would have no effect / fail.
  let query = getClient()
    .from(TABLES.QUERY_LOGS)
    .select(
      'id, query_text, response_preview, latency_ms, feedback, validation_confidence, created_at',
      {
        count: 'exact',
      },
    )
    .eq('user_id', userId);

  if (search && search.trim().length > 0) {
    // ILIKE via Supabase's .ilike() — parameterized by the client library,
    // not string-interpolated. Backslashes must be escaped first (Postgres's
    // own LIKE/ILIKE escape character), then the wildcard metacharacters (%
    // and _), so a literal backslash in the search text (e.g. a Windows
    // path) matches literally instead of escaping the character after it.
    const escapedSearch = search.trim().replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
    query = query.ilike('query_text', `%${escapedSearch}%`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (error) throw toDbInternalError('Failed to list query logs', error.message);
  return { data: (data as DbQueryLogListRow[] | null) ?? [], total: count ?? 0 };
}

/**
 * Sets (or updates) the helpfulness feedback for a previously logged query.
 * Scoped to the owner in the same query as the lookup — a mismatched userId
 * (or nonexistent queryId) updates zero rows, which the caller surfaces as
 * the same 404 as a nonexistent query, matching the IDOR-prevention pattern
 * used by getDocument/deleteDocument (an attacker probing query IDs from
 * another account can never distinguish "not yours" from "doesn't exist").
 * Idempotent: resubmitting feedback for the same query overwrites the prior
 * value via a plain UPDATE rather than erroring or inserting a duplicate row.
 * @param queryId - UUID of the query_logs row
 * @param userId - Must match the row's owner
 * @param feedback - 'helpful' | 'not_helpful'
 * @throws {NotFoundError} If no query_logs row with this ID is owned by userId
 * @throws {InternalError} On database error
 */
export async function setQueryFeedback(
  queryId: string,
  userId: string,
  feedback: 'helpful' | 'not_helpful',
): Promise<void> {
  const { error, count } = await getClient()
    .from(TABLES.QUERY_LOGS)
    .update({ feedback }, { count: 'exact' })
    .eq('id', queryId)
    .eq('user_id', userId);

  if (error) throw toDbInternalError('Failed to set query feedback', error.message);
  if (count === 0) throw new NotFoundError(`Query ${queryId} not found`);
}

/**
 * Records the result of post-hoc answer validation against a query_logs row.
 * Fire-and-forget by design (called from the async validation path after an
 * SSE stream has already completed and closed) — callers should not await
 * this on any user-facing request path. Not scoped to a userId lookup like
 * setQueryFeedback because it's invoked internally right after logQuery with
 * the row id already known, not from a user-supplied queryId.
 * @param queryId - UUID of the query_logs row (from logQuery's return value)
 * @param confidence - Validation confidence score in [0, 1]
 * @param issueCount - Number of issues flagged by validateAnswer
 * @throws {InternalError} On database error
 */
export async function setQueryValidation(
  queryId: string,
  confidence: number,
  issueCount: number,
): Promise<void> {
  const { error } = await getClient()
    .from(TABLES.QUERY_LOGS)
    .update({ validation_confidence: confidence, validation_issue_count: issueCount })
    .eq('id', queryId);

  if (error) throw toDbInternalError('Failed to set query validation result', error.message);
}

/** Sensitive operations this app actually performs and can meaningfully audit. */
export type AuditOperation = 'document_upload' | 'document_delete' | 'query_submit';

/** Payload for inserting one audit_logs row. */
export interface InsertAuditLog {
  operation: AuditOperation;
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  details?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Inserts one audit_logs row for a sensitive operation. Best-effort: a
 * failure here is logged but never thrown — the audit trail is a secondary
 * record of the operation, not a precondition for it, so callers use this
 * as fire-and-forget rather than gating the operation's own success/failure
 * response on whether the audit write itself succeeded.
 * @param entry - The audit event to persist
 */
export async function insertAuditLog(entry: InsertAuditLog): Promise<void> {
  const { error } = await getClient()
    .from(TABLES.AUDIT_LOGS)
    .insert({
      operation: entry.operation,
      user_id: entry.userId ?? null,
      resource_id: entry.resourceId ?? null,
      resource_type: entry.resourceType ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      success: entry.success,
      details: entry.details ?? null,
      correlation_id: entry.correlationId ?? null,
    });

  if (error) {
    logger.warn('Failed to persist audit log entry', {
      operation: entry.operation,
      error: error.message,
    });
  }
}

/**
 * Deletes a document and all its associated chunks (cascade handled by DB foreign key).
 * Scoped to the owner — a mismatched userId deletes zero rows and surfaces as the
 * same 404 as a non-existent document, preventing IDOR-style unauthorized deletion.
 * @param documentId - UUID of the document to delete
 * @param userId - Must match the document's owner
 * @throws {NotFoundError} If no document with this ID is owned by userId
 * @throws {InternalError} On database error
 */
export async function deleteDocument(documentId: string, userId: string): Promise<void> {
  const result = await getClient()
    .from(TABLES.DOCUMENTS)
    .delete({ count: 'exact' })
    .eq('id', documentId)
    .eq('user_id', userId);

  assertOwnedMutationSucceeded(result, documentId, 'delete document');
}

// ─── Document Similarity ────────────────────────────────────────────────────────

export interface SimilarityPair {
  documentA: string;
  documentB: string;
  similarity: number;
}

/** Result of a similarity computation — flags when the corpus was too large to compute pairwise, rather than silently returning an empty/partial result. */
export interface SimilarityResult {
  pairs: SimilarityPair[];
  /** True when readyDocumentCount exceeded MAX_SIMILARITY_DOCS and computation was skipped entirely. */
  capped: boolean;
  /** Count of the caller's 'ready' documents considered (whether or not computation actually ran). */
  readyDocumentCount: number;
}

const SAMPLE_SIZE = 5;

/**
 * Hard ceiling on ready-document count for pairwise similarity computation.
 * The computation is O(N² × SAMPLE_SIZE²) dot products and the frontend
 * renders one graph node + up to MAX_EDGES_PER_NODE edges per document — both
 * degrade badly well before this app's free-tier hosting would fall over, so
 * the ceiling exists to fail fast with a clear message instead of a slow
 * response and an unreadable, cluttered graph. Revisit with a real
 * approximate-nearest-neighbor approach if usage ever approaches this.
 */
const MAX_SIMILARITY_DOCS = 150;

/** Per-node edge cap applied after computing all qualifying pairs, so the graph stays legible even with many documents that are all somewhat similar to each other (e.g. a corpus of near-duplicate reports). */
const MAX_EDGES_PER_NODE = 8;

/**
 * Computes cosine similarity between two vectors.
 * Pure function — no external dependencies.
 * @param a - First vector
 * @param b - Second vector (must be same length as a)
 * @returns Cosine similarity score (-1 to 1)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) continue;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Groups chunk rows by document_id, capping each document's sample at SAMPLE_SIZE and
 * skipping rows with missing/empty embeddings. Rows are expected pre-sorted by
 * document_id then chunk_index, so the first SAMPLE_SIZE kept per document are its
 * earliest chunks.
 * @param rows - Chunk rows fetched for the ready documents
 * @returns Map of document ID to sampled embeddings (up to SAMPLE_SIZE each)
 */
function groupEmbeddingsByDocument(
  rows: Array<{ document_id: string; embedding: number[]; chunk_index: number }>,
): Map<string, number[][]> {
  const docEmbeddings: Map<string, number[][]> = new Map();
  for (const row of rows) {
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) continue;
    const existing = docEmbeddings.get(row.document_id);
    if (existing) {
      if (existing.length < SAMPLE_SIZE) existing.push(row.embedding);
    } else {
      docEmbeddings.set(row.document_id, [row.embedding]);
    }
  }
  return docEmbeddings;
}

/**
 * Fetches all ready documents and their chunk embeddings.
 * Returns a map of document ID to array of embedding vectors.
 *
 * Chunks for every ready document are fetched in a single query (`IN` filter,
 * ordered by document_id then chunk_index) rather than one query per document —
 * PostgREST has no top-N-per-group operator, so the per-document SAMPLE_SIZE
 * cap is applied client-side by grouping the single result set and slicing
 * each group. This trades "fetch slightly more rows than the true minimum"
 * (bounded by each document's actual chunk_count) for one round trip instead
 * of N concurrent ones — a better trade at the document counts this view is
 * used at (a 50-document archive previously fired 50 concurrent requests).
 * @param userId - Restricts results to documents owned by this user
 * @returns Ready documents and a map of document ID to sampled embeddings
 */
type ReadyDocSummary = {
  id: string;
  original_name: string;
  file_type: string;
  chunk_count: number;
};

/**
 * Fetches just the caller's ready documents (no chunk data) — cheap enough to
 * run unconditionally so the MAX_SIMILARITY_DOCS cap can be checked before
 * paying for the much larger chunk-embeddings fetch.
 * @param userId - Restricts results to documents owned by this user
 */
async function fetchReadyDocuments(userId: string): Promise<ReadyDocSummary[]> {
  const { data: docs, error: docsError } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id, original_name, file_type, chunk_count')
    .eq('status', 'ready')
    .eq('user_id', userId);

  if (docsError)
    throw toDbInternalError('Failed to fetch documents for similarity', docsError.message);
  return (docs as ReadyDocSummary[] | null) ?? [];
}

/**
 * Fetches all ready documents and their chunk embeddings.
 * Returns a map of document ID to array of embedding vectors.
 *
 * Chunks for every ready document are fetched in a single query (`IN` filter,
 * ordered by document_id then chunk_index) rather than one query per document —
 * PostgREST has no top-N-per-group operator, so the per-document SAMPLE_SIZE
 * cap is applied client-side by grouping the single result set and slicing
 * each group. This trades "fetch slightly more rows than the true minimum"
 * (bounded by each document's actual chunk_count) for one round trip instead
 * of N concurrent ones — a better trade at the document counts this view is
 * used at (a 50-document archive previously fired 50 concurrent requests).
 * @param userId - Restricts results to documents owned by this user
 * @param documents - Already-fetched ready documents (avoids re-querying them)
 * @returns Ready documents and a map of document ID to sampled embeddings
 */
async function fetchReadyDocumentEmbeddings(
  userId: string,
  documents: ReadyDocSummary[],
): Promise<{
  documents: ReadyDocSummary[];
  embeddings: Map<string, number[][]>;
}> {
  if (documents.length === 0) return { documents, embeddings: new Map() };

  const documentIds = documents.map((d) => d.id);
  const { data: chunks, error: chunksError } = await getClient()
    .from(TABLES.CHUNKS)
    .select('document_id, embedding, chunk_index')
    .in('document_id', documentIds)
    .order('document_id')
    .order('chunk_index');

  if (chunksError) {
    logger.warn('Failed to fetch chunks for similarity', { userId, error: chunksError.message });
    return { documents, embeddings: new Map() };
  }

  const rows =
    (chunks as Array<{ document_id: string; embedding: number[]; chunk_index: number }>) ?? [];
  return { documents, embeddings: groupEmbeddingsByDocument(rows) };
}

/**
 * Computes pairwise document similarity by sampling representative
 * chunks from each document and averaging cosine similarity scores.
 * Samples up to SAMPLE_SIZE chunks per document to keep query cost low.
 * Only processes documents with status 'ready'.
 *
 * Performance ceiling: N docs × SAMPLE_SIZE chunks = O(N² × SAMPLE_SIZE²) dot products.
 * With 10 docs × 5 chunks = 1125 dot products max — negligible compute.
 *
 * @param threshold - Minimum similarity to include in results
 * @param userId - Restricts comparison to documents owned by this user
 * @returns Array of document pairs with similarity scores
 */
export async function computeDocumentSimilarity(
  threshold: number,
  userId: string,
): Promise<SimilarityResult> {
  // Cheap doc-count-only check first — the cap must be enforced BEFORE paying
  // for the much larger chunk-embeddings fetch, not after, or the whole point
  // of failing fast on an oversized corpus is defeated.
  const readyDocs = await fetchReadyDocuments(userId);
  const readyDocumentCount = readyDocs.length;

  if (readyDocumentCount < 2) return { pairs: [], capped: false, readyDocumentCount };
  if (readyDocumentCount > MAX_SIMILARITY_DOCS) {
    return { pairs: [], capped: true, readyDocumentCount };
  }

  const { documents, embeddings: docEmbeddings } = await fetchReadyDocumentEmbeddings(
    userId,
    readyDocs,
  );
  const docsWithEmbeddings = documents.filter((d) => docEmbeddings.has(d.id));
  if (docsWithEmbeddings.length < 2) return { pairs: [], capped: false, readyDocumentCount };

  const allPairs = computePairwiseSimilarity(docsWithEmbeddings, docEmbeddings, threshold);
  return { pairs: capEdgesPerNode(allPairs), capped: false, readyDocumentCount };
}

/**
 * Keeps only each document's strongest MAX_EDGES_PER_NODE edges, so no node
 * in the rendered graph ends up with an unreadable fan-out even when many
 * documents all cross the similarity threshold with each other (e.g. a "hub"
 * document similar to dozens of others). A pair survives only if it's within
 * BOTH endpoints' individual top-K by similarity — requiring both ends to
 * agree is what actually bounds every node's degree to K; requiring only one
 * end would let a high-degree hub keep all its edges anytime the other side
 * of each edge happens to have few candidates of its own.
 * @param pairs - All pairs that met the similarity threshold
 * @returns Filtered pairs, with every document's degree bounded by MAX_EDGES_PER_NODE
 */
function capEdgesPerNode(pairs: SimilarityPair[]): SimilarityPair[] {
  if (pairs.length === 0) return pairs;

  const byDoc = new Map<string, SimilarityPair[]>();
  for (const pair of pairs) {
    for (const docId of [pair.documentA, pair.documentB]) {
      const list = byDoc.get(docId) ?? [];
      list.push(pair);
      byDoc.set(docId, list);
    }
  }

  const pairKey = (p: SimilarityPair): string => `${p.documentA}::${p.documentB}`;
  const topKPairKeysByDoc = new Map<string, Set<string>>();
  for (const [docId, list] of byDoc) {
    const top = [...list].sort((a, b) => b.similarity - a.similarity).slice(0, MAX_EDGES_PER_NODE);
    topKPairKeysByDoc.set(docId, new Set(top.map(pairKey)));
  }

  return pairs.filter((p) => {
    const key = pairKey(p);
    return (
      topKPairKeysByDoc.get(p.documentA)?.has(key) && topKPairKeysByDoc.get(p.documentB)?.has(key)
    );
  });
}

/**
 * Computes the average cosine similarity between all chunk pairs of two embeddings sets.
 * @param embeddingsA - Sampled embeddings for the first document
 * @param embeddingsB - Sampled embeddings for the second document
 * @returns Mean cosine similarity across all embA × embB pairs
 */
function averagePairSimilarity(embeddingsA: number[][], embeddingsB: number[][]): number {
  let total = 0;
  let count = 0;
  for (const embA of embeddingsA) {
    for (const embB of embeddingsB) {
      total += cosineSimilarity(embA, embB);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * Processes a single document pair — if their average similarity meets the threshold,
 * returns a SimilarityPair, otherwise null.
 */
function processDocPair(
  docA: { id: string },
  docB: { id: string },
  docEmbeddings: Map<string, number[][]>,
  threshold: number,
): SimilarityPair | null {
  const embeddingsA = docEmbeddings.get(docA.id);
  const embeddingsB = docEmbeddings.get(docB.id);
  if (!embeddingsA || !embeddingsB) return null;

  const avgSimilarity = averagePairSimilarity(embeddingsA, embeddingsB);
  if (avgSimilarity < threshold) return null;

  return {
    documentA: docA.id,
    documentB: docB.id,
    similarity: Math.round(avgSimilarity * 100) / 100,
  };
}

/**
 * Computes pairwise average cosine similarity for all document pairs.
 * Only returns pairs whose similarity meets or exceeds the threshold.
 * @param docs - Documents to compare, pairwise
 * @param docEmbeddings - Map of document ID to sampled embeddings
 * @param threshold - Minimum average similarity to include a pair
 * @returns Document pairs meeting the threshold, rounded to 2 decimal places
 */
function computePairwiseSimilarity(
  docs: Array<{ id: string }>,
  docEmbeddings: Map<string, number[][]>,
  threshold: number,
): SimilarityPair[] {
  const pairs: SimilarityPair[] = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const docA = docs[i];
      const docB = docs[j];
      if (!docA || !docB) continue;

      const pair = processDocPair(docA, docB, docEmbeddings, threshold);
      if (pair) pairs.push(pair);
    }
  }

  return pairs;
}
