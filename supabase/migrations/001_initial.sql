-- ============================================================
-- Migration: 001_initial.sql
-- Purpose:   Bootstrap schema — extensions, core tables, per-user
--            isolation, vector similarity search RPC, RLS policies
-- Author:    [Author Placeholder]
-- Created:   2026-07-18
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────────────────────

-- pgvector: stores and indexes high-dimensional embedding vectors.
-- Requires Supabase pgvector add-on (enabled by default on hosted Supabase).
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp: provides uuid_generate_v4(). We use gen_random_uuid() (built-in
-- since PG 13) for table defaults, but uuid-ossp is kept for compatibility with
-- any tooling that calls uuid_generate_v4() explicitly.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_trgm: trigram-based fuzzy full-text search on chunk content.
-- Powers the GIN index used by LIKE/ILIKE and similarity operators.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ── Table: documents ──────────────────────────────────────────────────────────
--
-- Central registry of uploaded files. One row per upload.
-- Processing state machine: pending → processing → ready | failed.
-- The filename column holds the server-assigned storage key (UUID-prefixed);
-- original_name preserves the user-visible display name.

CREATE TABLE IF NOT EXISTS documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Server-assigned storage filename (e.g. "a1b2c3-report.pdf").
  filename        TEXT        NOT NULL,

  -- User-visible display name preserved from the original upload.
  original_name   TEXT        NOT NULL,

  -- Extension-based file type validated at upload time (magic bytes verified
  -- in fileValidator.ts before this row is created).
  file_type       TEXT        NOT NULL
                    CHECK (file_type IN ('pdf', 'txt', 'md', 'docx')),

  -- Raw byte size of the uploaded file. INTEGER supports files up to ~2 GB
  -- which exceeds our 10 MB upload limit by a wide margin.
  file_size_bytes INTEGER     NOT NULL,

  -- Processing lifecycle status.
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),

  -- Populated by the document worker after chunking + embedding completes.
  chunk_count     INTEGER     DEFAULT 0,

  -- Populated only when status = 'failed'. Surfaced to the frontend.
  error_message   TEXT,

  -- Free-form bag for parser-specific output (page count, author, etc.).
  metadata        JSONB       DEFAULT '{}',

  -- Clerk user ID (sub claim) that owns this document.
  user_id         TEXT        NOT NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Status is the most frequent filter (dashboard polling, worker queries).
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents (status);

-- Default sort order on the documents list view.
CREATE INDEX IF NOT EXISTS idx_documents_created_at
  ON documents (created_at DESC);

-- Allows filtering/grouping by file type on the analytics dashboard.
CREATE INDEX IF NOT EXISTS idx_documents_file_type
  ON documents (file_type);

-- Per-user filtering — every document list/read/delete query is scoped by owner.
CREATE INDEX IF NOT EXISTS idx_documents_user_id
  ON documents (user_id);

-- ── Trigger: updated_at ───────────────────────────────────────────────────────
--
-- Automatically stamps updated_at on every UPDATE so callers never need to
-- set it manually. Using OR REPLACE so the function is safe to re-run.

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Create trigger only if it does not already exist (idempotent migration).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_documents_updated_at'
      AND tgrelid = 'documents'::regclass
  ) THEN
    CREATE TRIGGER trg_documents_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
  END IF;
END;
$$;


-- ── Table: document_chunks ────────────────────────────────────────────────────
--
-- Stores the text segments produced by the chunker service along with their
-- 384-dimensional embedding vectors (all-MiniLM-L6-v2).
--
-- Embedding is NULLABLE: the row is inserted immediately after chunking so the
-- document worker can checkpoint progress. The embedder then fills in the
-- vector in a subsequent UPDATE. Rows with NULL embeddings are excluded from
-- the similarity search RPC via an IS NOT NULL guard.
--
-- No user_id column of its own: chunks are always reached through a
-- user-scoped documents lookup (owner-checked query or CASCADE delete), so
-- they inherit isolation transitively from their parent document.

CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cascade delete: removing a document cleans up all its chunks automatically.
  document_id   UUID    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Zero-based position within the parent document. Used for citation ordering.
  chunk_index   INTEGER NOT NULL,

  -- Raw chunk text. Stored for retrieval and displayed as citation excerpts.
  content       TEXT    NOT NULL,

  -- 384-dim vector from sentence-transformers/all-MiniLM-L6-v2.
  -- NULL until the embedding step completes (see note above).
  embedding     vector(384),

  -- Approximate token count for context-window budget management in the LLM.
  token_count   INTEGER,

  -- Chunk-level metadata: page numbers, section headings, char offsets, etc.
  metadata      JSONB   DEFAULT '{}',

  created_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Enforce uniqueness so the worker can safely UPSERT on retry.
  UNIQUE (document_id, chunk_index)
);

-- Foreign-key lookups and "get all chunks for document" queries.
CREATE INDEX IF NOT EXISTS idx_chunks_document_id
  ON document_chunks (document_id);

-- IVFFlat approximate nearest-neighbour index on cosine distance.
--
-- WHY IVFFlat over HNSW:
--   • IVFFlat has a lower memory footprint — critical on Supabase Free/Pro tiers
--     where RAM is constrained. HNSW keeps the full graph in memory at all times.
--   • At our expected scale (<100 k chunks) the recall difference is negligible.
--   • IVFFlat build time is O(n) vs HNSW's O(n log n), making index creation
--     faster during bulk loads and migrations.
--   • lists=100 is the recommended starting point for datasets up to ~1 M rows
--     (guideline: lists ≈ sqrt(total_rows)). Tune upward when row count grows.
--
-- NOTE: IVFFlat requires at least `lists` rows before it is useful.
--       The search function guards against querying an empty index.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_cosine
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- GIN trigram index on chunk content.
-- Enables sub-millisecond ILIKE '%keyword%' and pg_trgm similarity() queries
-- across millions of rows without a sequential scan. Not currently exercised
-- by application code (only vector search is used today) but kept as a
-- low-cost foundation for future keyword/hybrid search.
CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm
  ON document_chunks
  USING gin (content gin_trgm_ops);


-- ── Table: query_logs ─────────────────────────────────────────────────────────
--
-- Append-only audit log of every RAG query. Used for:
--   • Latency monitoring and p95/p99 dashboards
--   • Debugging poor-quality answers by inspecting which chunks were retrieved
--   • Future fine-tuning dataset collection

CREATE TABLE IF NOT EXISTS query_logs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The raw user query string.
  query_text          TEXT        NOT NULL,

  -- Array of chunk UUIDs returned by match_chunks for this query.
  retrieved_chunk_ids UUID[],

  -- First 500 characters of the LLM response (truncated to keep table lean).
  response_preview    TEXT,

  -- End-to-end latency from query receipt to first SSE token (milliseconds).
  latency_ms          INTEGER,

  -- Clerk user ID (sub claim) that issued this query.
  user_id             TEXT        NOT NULL,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for time-range queries used by analytics dashboards.
CREATE INDEX IF NOT EXISTS idx_query_logs_created_at
  ON query_logs (created_at DESC);

-- Per-user filtering.
CREATE INDEX IF NOT EXISTS idx_query_logs_user_id
  ON query_logs (user_id);


-- ── Function: match_chunks ────────────────────────────────────────────────────
--
-- Vector similarity search RPC. Called by the query service via supabase.rpc().
--
-- Algorithm:
--   1. Compute cosine distance between query_embedding and each stored embedding
--      using the <=> operator (pgvector cosine distance, range [0, 2]).
--   2. Convert to similarity: similarity = 1 - distance, clamped to [0, 1] via
--      GREATEST(0.0, …) — all-MiniLM-L6-v2 produces un-normalized vectors so
--      distances above 1.0 are common, which would otherwise yield negative
--      similarity values that break confidence display.
--   3. Filter rows below similarity_threshold (removes low-quality matches).
--   4. Apply a per-document quota when more than one document is selected via
--      filter_document_ids, so a large document's chunks can't fill every
--      match_count slot and silently exclude a smaller, explicitly-selected
--      document from citations and LLM context.
--   5. Sort descending by similarity and return the top match_count rows,
--      with document metadata joined in.
--
-- The function only searches chunks from documents with status = 'ready',
-- skips chunks where the embedding has not yet been populated, and — when
-- p_user_id is supplied — restricts results to that user's own documents as
-- a defense-in-depth layer beneath the application-level filtering already
-- enforced in vectorStore.ts.
--
-- Parameters:
--   query_embedding      — 384-dim float vector produced by the embedder service
--   match_count          — maximum rows to return (default 5)
--   similarity_threshold — minimum cosine similarity to include (default 0,
--                          i.e. discards only orthogonal/opposite-direction
--                          vectors; all-MiniLM-L6-v2 is not tuned for
--                          asymmetric question/passage retrieval, so
--                          legitimate matches can score anywhere from 0 to
--                          ~0.3 — match_count bounds result size instead)
--   filter_document_ids  — optional UUID[] to restrict the search to specific
--                          documents (NULL/omitted searches all ready documents)
--   p_user_id            — restricts results to chunks whose parent document is
--                          owned by this user (NULL/omitted applies no filter;
--                          every real call site always supplies it)

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding      vector(384),
  match_count          INT     DEFAULT 5,
  similarity_threshold FLOAT   DEFAULT 0,
  filter_document_ids  UUID[]  DEFAULT NULL,
  p_user_id            TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  content     TEXT,
  metadata    JSONB,
  filename    TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
DECLARE
  per_doc_cap INT;
BEGIN
  -- Only apply a per-document quota when the caller explicitly filtered to
  -- more than one document — an unfiltered (or single-document) search has
  -- no fairness concern and keeps the original pure top-K behaviour.
  IF filter_document_ids IS NOT NULL AND array_length(filter_document_ids, 1) > 1 THEN
    per_doc_cap := CEIL(match_count::FLOAT / array_length(filter_document_ids, 1));
  ELSE
    per_doc_cap := match_count;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      -- original_name is the user-visible display name; filename is the
      -- UUID-prefixed storage key and should never reach the client.
      d.original_name AS filename,
      -- GREATEST(0, …) clamps cosine-distance artefacts to [0, 1].
      GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
      ROW_NUMBER() OVER (
        PARTITION BY dc.document_id
        ORDER BY dc.embedding <=> query_embedding
      ) AS doc_rank
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE
      -- Only surface chunks from fully processed documents.
      d.status = 'ready'
      -- Skip unembedded chunks (pending embedding worker step).
      AND dc.embedding IS NOT NULL
      -- Restrict to the caller's selected documents when provided.
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
      -- Restrict to the caller's own documents when provided.
      AND (p_user_id IS NULL OR d.user_id = p_user_id)
      -- Apply similarity floor before materialising rows.
      AND GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding)) >= similarity_threshold
  )
  SELECT
    candidates.id,
    candidates.document_id,
    candidates.content,
    candidates.metadata,
    candidates.filename,
    candidates.similarity
  FROM candidates
  WHERE doc_rank <= per_doc_cap
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


-- ── Row Level Security ────────────────────────────────────────────────────────
--
-- RLS is enabled on every table. The backend's service_role key bypasses RLS
-- by design in Supabase — per-user isolation for the API is enforced in
-- application code (vectorStore.ts filters every query by user_id). The
-- `authenticated`-role policies below are a second layer for the case where
-- Supabase is configured to trust Clerk's JWKS as a Postgres JWT issuer
-- (https://clerk.com/docs/integrations/databases/supabase).

ALTER TABLE documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_logs      ENABLE ROW LEVEL SECURITY;

-- Service role bypass: the backend service worker has unrestricted access.
CREATE POLICY "service_role_all_documents"
  ON documents FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_all_chunks"
  ON document_chunks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_all_query_logs"
  ON query_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated-role policies scoped to the row's owner (Clerk sub claim).
CREATE POLICY "users_own_documents" ON documents
  FOR ALL
  TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "users_own_chunks" ON document_chunks
  FOR ALL
  TO authenticated
  USING (
    document_id IN (
      SELECT id FROM documents WHERE user_id = (auth.jwt() ->> 'sub')
    )
  );

CREATE POLICY "users_own_query_logs" ON query_logs
  FOR ALL
  TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
