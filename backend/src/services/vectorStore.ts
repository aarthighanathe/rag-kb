/**
 * @file vectorStore.ts
 * @description Supabase pgvector operations — upsert chunks, similarity search, document CRUD
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { InternalError,
  NotFoundError,
  type DocumentRecord,
  type RetrievedChunk,
  type DocumentStatus,
  type FileType,
  type InsertQueryLog,
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
} as const;

/** RPC function name for pgvector similarity search (defined in 001_initial.sql). */
const MATCH_CHUNKS_FN = 'match_chunks';

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
  };
  if (row.error_message !== null && row.error_message !== undefined) {
    result.error_message = row.error_message as string;
  }
  return result;
}

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
    .update({ chunk_count: chunkCount, status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', documentId);

  if (error) throw toDbInternalError('Failed to update chunk count', error.message);
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
 * Runtime shape check for one match_chunks RPC row, mirroring embedder.ts's
 * isEmbeddingArrayShape guard for the analogous external-response boundary.
 * A row missing/null on any required field would otherwise flow straight into
 * extractCitations/buildContextString and produce a corrupted citation or a
 * broken prompt with no error raised anywhere.
 * @param row - A single row from the match_chunks RPC response
 * @returns true if the row has all required RetrievedChunk fields with correct types
 */
function isValidRetrievedChunk(row: unknown): row is RetrievedChunk {
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
 * @param similarityThreshold - Optional minimum cosine similarity (defaults to the SQL function's default)
 * @returns Array of retrieved chunks sorted by similarity descending
 * @throws {InternalError} On RPC error
 */
export async function similaritySearch(
  queryEmbedding: number[],
  topK: number,
  userId: string,
  documentIds?: string[],
  similarityThreshold?: number,
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

  // Explicit type annotation prevents no-unsafe-assignment from the generic Supabase return
  const rpcResult = await getClient().rpc(MATCH_CHUNKS_FN, params);
  const { data, error } = rpcResult as {
    data: unknown[] | null;
    error: { message: string } | null;
  };

  if (error) throw toDbInternalError('Vector search failed', error.message);
  if (!data) return [];

  const validRows: RetrievedChunk[] = [];
  let droppedCount = 0;
  for (const row of data) {
    if (isValidRetrievedChunk(row)) {
      validRows.push(row);
    } else {
      droppedCount++;
    }
  }
  if (droppedCount > 0) {
    logger.warn('Dropped malformed rows from match_chunks RPC response', {
      droppedCount,
      totalCount: data.length,
    });
  }
  return validRows;
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
  const { data: ownerCheck, error: ownerError } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id')
    .eq('id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownerError) throw toDbInternalError('Failed to verify document ownership', ownerError.message);
  if (!ownerCheck) throw new NotFoundError(`Document ${documentId} not found`);

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
 * Deletes a document and all its associated chunks (cascade handled by DB foreign key).
 * Scoped to the owner — a mismatched userId deletes zero rows and surfaces as the
 * same 404 as a non-existent document, preventing IDOR-style unauthorized deletion.
 * @param documentId - UUID of the document to delete
 * @param userId - Must match the document's owner
 * @throws {NotFoundError} If no document with this ID is owned by userId
 * @throws {InternalError} On database error
 */
export async function deleteDocument(documentId: string, userId: string): Promise<void> {
  const { error, count } = await getClient()
    .from(TABLES.DOCUMENTS)
    .delete({ count: 'exact' })
    .eq('id', documentId)
    .eq('user_id', userId);

  if (error) throw toDbInternalError('Failed to delete document', error.message);
  if (count === 0) throw new NotFoundError(`Document ${documentId} not found`);
}

// ─── Document Similarity ────────────────────────────────────────────────────────

export interface SimilarityPair {
  documentA: string;
  documentB: string;
  similarity: number;
}

const SAMPLE_SIZE = 5;

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
async function fetchReadyDocumentEmbeddings(userId: string): Promise<{
  documents: Array<{ id: string; original_name: string; file_type: string; chunk_count: number }>;
  embeddings: Map<string, number[][]>;
}> {
  const { data: docs, error: docsError } = await getClient()
    .from(TABLES.DOCUMENTS)
    .select('id, original_name, file_type, chunk_count')
    .eq('status', 'ready')
    .eq('user_id', userId);

  if (docsError) throw toDbInternalError('Failed to fetch documents for similarity', docsError.message);
  const documents = (docs as Array<{ id: string; original_name: string; file_type: string; chunk_count: number }>) ?? [];

  const docEmbeddings: Map<string, number[][]> = new Map();
  if (documents.length === 0) return { documents, embeddings: docEmbeddings };

  const documentIds = documents.map((d) => d.id);
  const { data: chunks, error: chunksError } = await getClient()
    .from(TABLES.CHUNKS)
    .select('document_id, embedding, chunk_index')
    .in('document_id', documentIds)
    .order('document_id')
    .order('chunk_index');

  if (chunksError) {
    logger.warn('Failed to fetch chunks for similarity', { userId, error: chunksError.message });
    return { documents, embeddings: docEmbeddings };
  }

  const rows = (chunks as Array<{ document_id: string; embedding: number[]; chunk_index: number }>) ?? [];
  for (const row of rows) {
    if (!Array.isArray(row.embedding) || row.embedding.length === 0) continue;
    const existing = docEmbeddings.get(row.document_id);
    if (existing) {
      if (existing.length < SAMPLE_SIZE) existing.push(row.embedding);
    } else {
      docEmbeddings.set(row.document_id, [row.embedding]);
    }
  }

  return { documents, embeddings: docEmbeddings };
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
): Promise<SimilarityPair[]> {
  const { documents, embeddings: docEmbeddings } = await fetchReadyDocumentEmbeddings(userId);

  if (documents.length < 2) return [];

  const docsWithEmbeddings = documents.filter((d) => docEmbeddings.has(d.id));
  if (docsWithEmbeddings.length < 2) return [];

  return computePairwiseSimilarity(docsWithEmbeddings, docEmbeddings, threshold);
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
