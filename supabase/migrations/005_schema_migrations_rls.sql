-- ============================================================
-- Migration: 005_schema_migrations_rls.sql
-- Purpose:   Silences the Supabase dashboard's "RLS Disabled in Public"
--            linter warning for _schema_migrations. This table is created
--            by backend/scripts/migrate.ts purely to track which migration
--            files have been applied (filename + timestamp) — it holds no
--            user data and is only ever read/written via the migration
--            script's direct DATABASE_URL connection (which, like every
--            other privileged access path in this schema, bypasses RLS).
--            It is never queried through the app's public/anon Supabase
--            client, so a deny-all policy is correct: nothing should be
--            reading or writing this table via the API in any case.
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
-- ============================================================

ALTER TABLE _schema_migrations ENABLE ROW LEVEL SECURITY;

-- No policies are created, which — with RLS enabled — denies all access via
-- the PostgREST/API layer by default. The migration script's direct
-- Postgres connection (service-role-equivalent) is unaffected by RLS.
