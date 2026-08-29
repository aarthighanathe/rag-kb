-- ============================================================
-- Migration: 012_fix_match_chunks_ambiguous_similarity.sql
-- Purpose:   match_chunks fails at call time with "column reference
--            'similarity' is ambiguous". RETURNS TABLE (..., similarity FLOAT)
--            implicitly declares `similarity` as a PL/pgSQL variable in scope
--            for the whole function body. The candidates CTE separately
--            computes a column also aliased `similarity`, and later
--            references to the bare identifier `similarity` (in the WHERE
--            clause of `scored`, and in ORDER BY) become ambiguous between
--            the OUT-parameter variable and the CTE column — Postgres cannot
--            tell which one is meant. This only surfaces when the function is
--            invoked, not at CREATE FUNCTION time, so it shipped silently.
--
--            Fix: rename the internal computed column to sim_score
--            throughout the query body, and alias it back to `similarity`
--            only in the final SELECT list (which is unambiguous — it's a
--            direct output projection, not a bare identifier reference).
-- Author:    [Author Placeholder]
-- Created:   2026-08-29
-- ============================================================

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
BEGIN
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
      AND (p_user_id IS NULL OR d.user_id = p_user_id)
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
  'own top match by more than the gap. Internal scoring column is named '
  'sim_score (not similarity) to avoid PL/pgSQL ambiguity with the '
  'RETURNS TABLE output parameter of the same name.';


-- match_chunks_keyword (004_keyword_search.sql) has the same latent hazard:
-- RETURNS TABLE (..., similarity FLOAT) alongside a query column aliased
-- AS similarity, then ORDER BY similarity DESC as a bare identifier. It
-- hasn't errored yet only because the ORDER BY there happens to still
-- resolve the same way as the ambiguous case would sort — but it is not
-- guaranteed to hold across Postgres versions, and any future edit that adds
-- a WHERE/HAVING referencing the bare name would reproduce this bug. Fixed
-- here for the same reason and to keep both RPCs on the same safe pattern.
CREATE OR REPLACE FUNCTION match_chunks_keyword(
  query_text           TEXT,
  match_count          INT     DEFAULT 5,
  keyword_threshold     FLOAT   DEFAULT 0.15,
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
BEGIN
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
    AND (p_user_id IS NULL OR d.user_id = p_user_id)
    AND sim.sim_score >= keyword_threshold
  ORDER BY sim.sim_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_chunks_keyword IS
  'pg_trgm fuzzy keyword search over document_chunks.content, using the '
  'idx_chunks_content_trgm GIN index. Returns the same row shape as '
  'match_chunks so results can be merged for hybrid retrieval — see '
  'hybridSearch() in vectorStore.ts. Uses a LATERAL join to compute '
  'sim_score once and avoid the pg_trgm similarity() function name '
  'colliding with the RETURNS TABLE similarity output column.';
