-- ============================================================
-- Migration: 002_add_query_feedback.sql
-- Purpose:   Adds a user-submitted helpfulness signal to query_logs, so
--            retrieval/confidence tuning can eventually be validated against
--            real usage instead of hand-tuned embedding-score heuristics.
-- Author:    [Author Placeholder]
-- Created:   2026-07-18
-- ============================================================

-- ── Column: query_logs.feedback ─────────────────────────────────────────────
--
-- Nullable: most queries are never rated. A CHECK-constrained TEXT enum
-- (matching the file_type/status convention in 001_initial.sql) is used
-- instead of a BOOLEAN so a future value (e.g. 'partially_helpful') can be
-- added without a column-type migration — a boolean can only ever express
-- two states, and helpfulness feedback is exactly the kind of signal that's
-- likely to grow a middle option later.

ALTER TABLE query_logs
  ADD COLUMN IF NOT EXISTS feedback TEXT
    CHECK (feedback IN ('helpful', 'not_helpful'));

-- Supports the ownership-scoped upsert in POST /api/query/:queryId/feedback
-- (ownership check + update share a single WHERE id = ... AND user_id = ...
-- query, mirroring the getDocument/deleteDocument IDOR pattern in
-- vectorStore.ts) and any future "my rated queries" filtered read.
CREATE INDEX IF NOT EXISTS idx_query_logs_feedback
  ON query_logs (feedback)
  WHERE feedback IS NOT NULL;
