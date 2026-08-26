-- ============================================================
-- Migration: 007_add_query_validation.sql
-- Purpose:   Adds post-hoc answer-validation results to query_logs. Validation
--            runs asynchronously after the SSE stream completes (see
--            services/answerValidator.ts) so it never adds latency to the
--            user-facing response — this column lets the score be looked up
--            later (e.g. a confidence badge on query history).
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
-- ============================================================

-- ── Column: query_logs.validation_confidence ────────────────────────────────
--
-- Nullable: validation is fire-and-forget after stream completion, so a row
-- can exist before its validation finishes (or if validation itself fails —
-- answerValidator.ts fails open, but the caller may still not have written
-- back yet). Stored as a plain 0-1 float, matching the ValidationResult
-- shape returned by validateAnswer().

ALTER TABLE query_logs
  ADD COLUMN IF NOT EXISTS validation_confidence REAL
    CHECK (validation_confidence >= 0 AND validation_confidence <= 1);

-- ── Column: query_logs.validation_issue_count ───────────────────────────────
--
-- Denormalized count (rather than a full issues JSONB blob) — sufficient for
-- a history-list badge ("3 issues flagged") without needing to store or
-- serve the full per-issue detail for every past query.

ALTER TABLE query_logs
  ADD COLUMN IF NOT EXISTS validation_issue_count INTEGER
    CHECK (validation_issue_count >= 0);
