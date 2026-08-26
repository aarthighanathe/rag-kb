-- ============================================================
-- Migration: 004_keyword_search.sql
-- Purpose:   Wires up the pg_trgm GIN index (idx_chunks_content_trgm, added in
--            001_initial.sql) as an actual keyword/fuzzy-text search path. It
--            has existed since the initial schema but no application code has
--            ever queried it — dense vector search alone is weak on exact
--            terms (product codes, acronyms, part numbers, proper nouns)
--            because a bi-encoder embeds meaning, not exact tokens. This adds
--            a second retrieval RPC using pg_trgm's similarity() function,
--            with the same ownership/document/status filters as match_chunks,
--            so the two result sets can be merged application-side.
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
-- ============================================================

-- Parameters mirror match_chunks (001_initial.sql / 003_relative_similarity_floor.sql)
-- wherever the same concept applies, so the two RPCs can be called and merged
-- symmetrically in vectorStore.ts.
--
-- Uses pg_trgm's similarity(text, text) function (0-1, word/character overlap
-- ratio) rather than ILIKE '%term%', since similarity() tolerates minor typos
-- and word-order differences and returns a real score to merge against cosine
-- similarity, whereas ILIKE is a binary match with no ranking signal.

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
    similarity(dc.content, query_text)::FLOAT AS similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE
    d.status = 'ready'
    AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    AND (p_user_id IS NULL OR d.user_id = p_user_id)
    AND similarity(dc.content, query_text) >= keyword_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_chunks_keyword IS
  'pg_trgm fuzzy keyword search over document_chunks.content, using the '
  'idx_chunks_content_trgm GIN index. Returns the same row shape as '
  'match_chunks so results can be merged for hybrid retrieval — see '
  'hybridSearch() in vectorStore.ts.';
