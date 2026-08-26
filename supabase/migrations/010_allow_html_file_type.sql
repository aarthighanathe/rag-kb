-- ============================================================
-- Migration: 010_allow_html_file_type.sql
-- Purpose:   The application layer (Zod schema, magic-byte validator,
--            extractTextFromHtml) already accepts HTML uploads, but the
--            documents.file_type CHECK constraint from 001_initial.sql was
--            never updated to allow 'html'. Every HTML upload currently
--            passes validation and storage, then fails on INSERT with a raw
--            constraint-violation error. This migration brings the database
--            constraint in line with the application's supported file types.
-- Author:    [Author Placeholder]
-- Created:   2026-08-24
-- ============================================================

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_file_type_check;

ALTER TABLE documents
  ADD CONSTRAINT documents_file_type_check
    CHECK (file_type IN ('pdf', 'txt', 'md', 'docx', 'html'));
