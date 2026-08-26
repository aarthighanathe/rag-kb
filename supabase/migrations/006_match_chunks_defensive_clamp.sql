-- ============================================================
-- Migration: 006_match_chunks_defensive_clamp.sql
-- Purpose:   Hardens match_chunks against match_count = 0. Not reachable
--            through any current application code path — the Zod schema for
--            POST /api/query enforces matchCount >= 1 before the RPC is ever
--            called — but the SQL function itself had no defensive floor, so
--            a direct call (Supabase SQL editor, a future caller, a manual
--            RPC invocation) with match_count = 0 would compute
--            per_doc_cap := CEIL(0 / N) = 0, which — combined with the
--            per-document quota's `doc_rank <= per_doc_cap` filter — would
--            exclude every row, including the single highest-scoring
--            candidate that should always survive regardless of match_count.
--            This clamps per_doc_cap to a minimum of 1, matching the
--            single/unfiltered-document behaviour (which already always
--            uses match_count as-is with no lower clamp needed there, since
--            doc_rank <= match_count with match_count = 0 is likewise an
--            edge case worth covering the same way).
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
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
  -- Defensive floor: never let the quota drop below 1, so the top-ranked
  -- candidate in any given document always survives regardless of what
  -- match_count was passed (including 0, which the app layer already
  -- disallows via Zod, but the SQL function should not silently return zero
  -- rows for on a direct call).
  per_doc_cap := GREATEST(per_doc_cap, 1);

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
    relative_floor_gap <= 0
    OR scored.similarity >= scored.top_similarity - relative_floor_gap
  ORDER BY scored.similarity DESC
  LIMIT GREATEST(match_count, 0);
END;
$$;

COMMENT ON FUNCTION match_chunks IS
  'Cosine similarity search over document_chunks with an absolute floor '
  '(similarity_threshold), a per-selected-document fairness quota (clamped '
  'to a minimum of 1 so the top candidate always survives), and a relative '
  'floor (relative_floor_gap) that drops candidates trailing the batch''s '
  'own top match by more than the gap.';
