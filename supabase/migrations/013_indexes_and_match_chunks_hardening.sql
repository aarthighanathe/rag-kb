-- ============================================================
-- Migration: 013_indexes_and_match_chunks_hardening.sql
-- Purpose:   Three independent hardening changes surfaced by a full
--            pre-production audit:
--             1. match_chunks / match_chunks_keyword: p_user_id becomes a
--                required (non-nullable, no default) parameter instead of
--                silently meaning "no filter" when omitted or passed NULL.
--                Both RPCs run under the service_role key (bypassing RLS
--                entirely, per storage/vectorStore access pattern), so
--                p_user_id was the *only* per-user isolation at the DB
--                layer for these two functions — a future call site (e.g.
--                an admin/debug endpoint) that forgot to pass it would have
--                silently returned every user's chunks with no RLS
--                backstop to catch the mistake. Every current call site
--                (vectorStore.ts's similaritySearch/keywordSearch) already
--                always passes an explicit, non-null userId, so this is a
--                behavior-preserving tightening for real traffic today.
--             2. query_logs: adds a composite (user_id, created_at DESC)
--                index matching GET /api/query/history's actual access
--                pattern (scoped to the caller, most recent first) — the
--                two existing single-column indexes on this table can only
--                satisfy one half of that predicate each.
--             3. audit_logs: adds a partial index for failure-investigation
--                queries (WHERE success = false), the access pattern most
--                likely for "show me all failed uploads/deletes" support
--                and on-call tooling.
-- Author:    [Author Placeholder]
-- Created:   2026-08-31
-- ============================================================

-- ── 1. match_chunks / match_chunks_keyword: p_user_id required ─────────────
--
-- Both function bodies are otherwise byte-identical to their 012 definitions
-- (see that migration for the ambiguous-column-name fix) — only the
-- parameter signature and the WHERE clause's ownership check change here:
-- the `p_user_id IS NULL OR ...` bypass is removed, and the default value is
-- dropped so a caller must supply it explicitly.
--
-- Not marked SECURITY DEFINER (unchanged) — these run under whatever role
-- invokes them, which in this app's architecture is always the service_role
-- key (see README's architecture notes / vectorStore.ts), so this migration
-- does not itself add RLS protection; it removes the one code path that
-- could accidentally disable the manual per-user filter that stands in for it.
--
-- Both functions' parameter lists change here (p_user_id moves and loses its
-- default), which Postgres treats as a distinct overload rather than a
-- replacement of the existing signature — CREATE OR REPLACE alone would
-- leave the old 012 signature in place alongside this one, and every call
-- site (and the COMMENT ON FUNCTION below) becomes ambiguous ("function name
-- ... is not unique"). Same fix as 003_relative_similarity_floor.sql used
-- for the same class of problem: drop every existing overload of each
-- function by name via pg_proc before recreating it, so this migration is
-- idempotent regardless of which prior signature a given database has.
DO $$
DECLARE
  func_signature TEXT;
BEGIN
  FOR func_signature IN
    SELECT 'match_chunks(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'match_chunks' AND n.nspname = 'public'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_signature;
  END LOOP;

  FOR func_signature IN
    SELECT 'match_chunks_keyword(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'match_chunks_keyword' AND n.nspname = 'public'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_signature;
  END LOOP;
END $$;

-- p_user_id is positioned right after the two truly-required parameters and
-- before any DEFAULT-bearing one — Postgres requires every parameter after
-- the first one with a DEFAULT to also have one, so a required parameter
-- can no longer sit in the middle of the list once it has no default of its
-- own. This is purely a SQL positional-argument constraint; every actual
-- caller (Supabase's .rpc(), via vectorStore.ts) always calls with named
-- parameters, so this reordering has no effect on any real call site.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding      vector(384),
  p_user_id            TEXT,
  match_count          INT     DEFAULT 5,
  similarity_threshold FLOAT   DEFAULT 0,
  filter_document_ids  UUID[]  DEFAULT NULL,
  relative_floor_gap   FLOAT   DEFAULT 0.15
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'match_chunks: p_user_id is required';
  END IF;

  IF filter_document_ids IS NOT NULL AND array_length(filter_document_ids, 1) > 1 THEN
    per_doc_cap := CEIL(match_count::FLOAT / array_length(filter_document_ids, 1));
  ELSE
    per_doc_cap := match_count;
  END IF;
  per_doc_cap := GREATEST(per_doc_cap, 1);

  RETURN QUERY
  WITH candidates AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      d.original_name AS filename,
      GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding))::FLOAT AS sim_score,
      ROW_NUMBER() OVER (
        PARTITION BY dc.document_id
        ORDER BY dc.embedding <=> query_embedding
      ) AS doc_rank
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE
      d.status = 'ready'
      AND dc.embedding IS NOT NULL
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
      AND d.user_id = p_user_id
      AND GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding)) >= similarity_threshold
  ),
  scoped AS (
    SELECT * FROM candidates WHERE doc_rank <= per_doc_cap
  ),
  scored AS (
    SELECT scoped.*, MAX(scoped.sim_score) OVER () AS top_similarity FROM scoped
  )
  SELECT
    scored.id,
    scored.document_id,
    scored.content,
    scored.metadata,
    scored.filename,
    scored.sim_score AS similarity
  FROM scored
  WHERE
    relative_floor_gap <= 0
    OR scored.sim_score >= scored.top_similarity - relative_floor_gap
  ORDER BY scored.sim_score DESC
  LIMIT GREATEST(match_count, 0);
END;
$$;

COMMENT ON FUNCTION match_chunks IS
  'Cosine similarity search over document_chunks with an absolute floor '
  '(similarity_threshold), a per-selected-document fairness quota (clamped '
  'to a minimum of 1 so the top candidate always survives), and a relative '
  'floor (relative_floor_gap) that drops candidates trailing the batch''s '
  'own top match by more than the gap. p_user_id is required (not '
  'nullable) — every result is scoped to exactly one owning user; there is '
  'no "search across all users" mode. Internal scoring column is named '
  'sim_score (not similarity) to avoid PL/pgSQL ambiguity with the '
  'RETURNS TABLE output parameter of the same name.';

-- Same positional reordering as match_chunks above, for the same reason.
CREATE OR REPLACE FUNCTION match_chunks_keyword(
  query_text           TEXT,
  p_user_id            TEXT,
  match_count          INT     DEFAULT 5,
  keyword_threshold     FLOAT   DEFAULT 0.15,
  filter_document_ids  UUID[]  DEFAULT NULL
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
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'match_chunks_keyword: p_user_id is required';
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    dc.metadata,
    d.original_name AS filename,
    sim.sim_score AS similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  CROSS JOIN LATERAL (SELECT similarity(dc.content, query_text)::FLOAT AS sim_score) sim
  WHERE
    d.status = 'ready'
    AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    AND d.user_id = p_user_id
    AND sim.sim_score >= keyword_threshold
  ORDER BY sim.sim_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_chunks_keyword IS
  'pg_trgm fuzzy keyword search over document_chunks.content, using the '
  'idx_chunks_content_trgm GIN index. Returns the same row shape as '
  'match_chunks so results can be merged for hybrid retrieval — see '
  'hybridSearch() in vectorStore.ts. p_user_id is required (not nullable), '
  'matching match_chunks. Uses a LATERAL join to compute sim_score once '
  'and avoid the pg_trgm similarity() function name colliding with the '
  'RETURNS TABLE similarity output column.';


-- ── 2. query_logs: composite index for GET /api/query/history ──────────────
--
-- idx_query_logs_user_id (001_initial.sql) and idx_query_logs_created_at
-- (001_initial.sql) each cover one half of "this user's queries, most
-- recent first" — Postgres can only use one efficiently per scan without a
-- BitmapAnd, which itself costs more than a single composite index scan
-- would. The single-column idx_query_logs_user_id is superseded by this
-- composite (any query that could use the former can use this instead,
-- since user_id is the leading column) and is dropped; idx_query_logs_created_at
-- is left in place for any query that filters/sorts by created_at alone
-- without a user_id predicate (e.g. a future admin/ops dashboard).

CREATE INDEX IF NOT EXISTS idx_query_logs_user_created
  ON query_logs (user_id, created_at DESC);

DROP INDEX IF EXISTS idx_query_logs_user_id;


-- ── 3. audit_logs: partial index for failure investigation ─────────────────
--
-- Supports `WHERE operation = ? AND success = false` (or just
-- `WHERE success = false`) without a full-table scan as audit_logs grows —
-- the access pattern for "show me recent failed uploads/deletes" tooling.
-- Partial (WHERE success = false) keeps the index small since successful
-- operations are expected to vastly outnumber failures.

CREATE INDEX IF NOT EXISTS idx_audit_logs_failures
  ON audit_logs (operation, created_at DESC)
  WHERE success = false;


-- ── Note: IVFFlat index rebuild after initial data load ─────────────────────
--
-- idx_chunks_embedding_cosine (001_initial.sql) is an IVFFlat index, created
-- at migration time against an empty document_chunks table. IVFFlat's
-- clustering is computed from the data present when the index is built —
-- built against zero rows, every list is degenerate, and recall stays poor
-- indefinitely until the index is rebuilt against a populated table. This
-- migration does not (and cannot, safely, as a blind schema migration) run
-- that rebuild automatically, since "populated" isn't a fixed point in time
-- this file can wait for. Ops runbook: after the first significant batch of
-- documents has been embedded (e.g. a few thousand chunks), run:
--   REINDEX INDEX CONCURRENTLY idx_chunks_embedding_cosine;
-- and repeat periodically as the corpus grows substantially (IVFFlat's
-- clustering quality degrades as the table grows well past the size it was
-- last built against). CONCURRENTLY avoids locking out reads/writes during
-- the rebuild; it cannot run inside a transaction block, which is also why
-- it isn't bundled into this migration file (Supabase migrations run
-- transactionally).
