-- ============================================================
-- Migration: 011_add_document_tags.sql
-- Purpose:   Adds a tags column to documents for organization/filtering.
--            Auto-populated from distinct section headings detected during
--            chunking (services/chunker.ts's section-aware chunking, no
--            extra LLM call — reuses data already produced for free) and
--            editable by the user via PATCH /api/documents/:id/tags.
-- Author:    [Author Placeholder]
-- Created:   2026-08-24
-- ============================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Supports "documents with this tag" filtering (GIN index for array containment queries).
CREATE INDEX IF NOT EXISTS idx_documents_tags
  ON documents USING GIN (tags);
