-- ============================================================
-- Migration: 009_add_document_fingerprint.sql
-- Purpose:   Adds a content hash to documents so a re-upload of the exact same
--            file (a common accident — dragging the same PDF in twice, or an
--            upload retried after a flaky connection) can be detected and
--            surfaced to the user as a duplicate, instead of silently
--            creating a second copy that doubles storage and embedding cost.
-- Author:    [Author Placeholder]
-- Created:   2026-08-24
-- ============================================================

-- ── Column: documents.content_hash ──────────────────────────────────────────
--
-- SHA-256 of the raw uploaded file bytes, computed before any parsing —
-- catches byte-identical re-uploads regardless of filename. Nullable so
-- existing rows (uploaded before this migration) don't need a backfill to
-- remain valid; a NULL hash is simply never matched as a duplicate.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Scoped per-user (not globally unique) — two different users uploading the
-- same public PDF is not a duplicate in any sense that matters to either of
-- them, and a global uniqueness constraint would leak cross-user information
-- (an insert failure would reveal that some other user already has this
-- exact file). Partial index (WHERE NOT NULL) keeps it small since most
-- lookups only ever check hashes within one user's own documents.
CREATE INDEX IF NOT EXISTS idx_documents_user_content_hash
  ON documents (user_id, content_hash)
  WHERE content_hash IS NOT NULL;
