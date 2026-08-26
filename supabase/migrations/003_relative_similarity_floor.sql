-- ============================================================
-- Migration: 003_relative_similarity_floor.sql
-- Purpose:   match_chunks currently only drops rows below an absolute
--            similarity_threshold, which defaults to 0 (i.e. no real floor —
--            see 001_initial.sql). With all-MiniLM-L6-v2's low, spread-out
--            similarity scores, that means a query with only 1-2 genuinely
--            relevant chunks still gets padded out to match_count with
--            whatever scored next-highest, however weak — and those weak
--            chunks are handed to the LLM as "relevant source passages"
--            with no signal that they're noise.
--
--            This adds a RELATIVE floor on top of the existing absolute one:
--            after the absolute threshold and ownership/document filters are
--            applied, drop any candidate whose similarity trails the best
--            match in that same result set by more than relative_floor_gap.
--            This adapts to each query's own score distribution instead of
--            a fixed cutoff, so it doesn't need retuning if the embedding
--            model or threshold conventions change later.
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
-- ============================================================

-- Postgres treats a changed parameter list as a distinct overload, so
-- CREATE OR REPLACE alone would leave any existing match_chunks signature(s)
-- in place alongside this new 6-arg one — and then every call site becomes
-- ambiguous ("function name "match_chunks" is not unique"). Rather than
-- guessing the exact prior signature (which can drift between environments
-- that applied migrations in a different order/state), drop every overload
-- of match_chunks by name via pg_proc/pg_catalog before recreating it, so
-- this migration is idempotent regardless of what signature(s) already
-- exist on a given database.
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
END $$;

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding      vector(384),
  match_count          INT     DEFAULT 5,
  similarity_threshold FLOAT   DEFAULT 0,
  filter_document_ids  UUID[]  DEFAULT NULL,
  p_user_id            TEXT    DEFAULT NULL,
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
  top_score   FLOAT;
BEGIN
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
      d.original_name AS filename,
      GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding))::FLOAT AS similarity,
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
      AND (p_user_id IS NULL OR d.user_id = p_user_id)
      AND GREATEST(0.0, 1.0 - (dc.embedding <=> query_embedding)) >= similarity_threshold
  ),
  scoped AS (
    -- Per-document quota applied before the relative floor is computed, so the
    -- floor reflects the actual candidate pool that will be considered, not
    -- scores from documents that were already excluded by the quota.
    SELECT * FROM candidates WHERE doc_rank <= per_doc_cap
  ),
  scored AS (
    SELECT scoped.*, MAX(similarity) OVER () AS top_similarity FROM scoped
  )
  SELECT
    scored.id,
    scored.document_id,
    scored.content,
    scored.metadata,
    scored.filename,
    scored.similarity
  FROM scored
  WHERE
    -- relative_floor_gap <= 0 disables the relative floor entirely (opt-out),
    -- matching the pre-migration behaviour for any caller that wants it.
    relative_floor_gap <= 0
    OR scored.similarity >= scored.top_similarity - relative_floor_gap
  ORDER BY scored.similarity DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_chunks IS
  'Cosine similarity search over document_chunks with an absolute floor '
  '(similarity_threshold), a per-selected-document fairness quota, and a '
  'relative floor (relative_floor_gap) that drops candidates trailing the '
  'batch''s own top match by more than the gap — prevents padding weak '
  'results out to match_count when few genuinely relevant chunks exist.';
