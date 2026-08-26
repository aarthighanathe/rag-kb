-- ============================================================
-- Migration: 008_add_audit_logs.sql
-- Purpose:   Adds a real audit_logs table. auditLogger.ts previously only
--            called logger.warn/info (Winston, log-line only) despite being
--            named/positioned as an audit trail — this table gives sensitive
--            operations (document upload/delete, query submission) actual
--            queryable persistence, independent of log retention/rotation.
-- Author:    [Author Placeholder]
-- Created:   2026-08-23
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation      TEXT NOT NULL,
  user_id        TEXT,
  resource_id    TEXT,
  resource_type  TEXT,
  ip_address     TEXT,
  user_agent     TEXT,
  success        BOOLEAN NOT NULL,
  details        JSONB,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scoped to this app's actual sensitive operations (document upload/delete,
-- query submission) — not the full enum auditLogger.ts originally defined,
-- most of which (password change, API keys, user suspension, data export)
-- have no corresponding route in this app: auth is delegated entirely to
-- Clerk, and there is no export/admin-user-management feature. A CHECK
-- constraint (not a Postgres ENUM) so adding an operation later is a
-- zero-downtime ALTER rather than an ALTER TYPE migration.
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_operation_check
  CHECK (operation IN ('document_upload', 'document_delete', 'query_submit'));

-- Supports "audit trail for this user" and "audit trail for this document/query"
-- lookups — the two access patterns an admin or support investigation would
-- actually use.
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs (resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

-- RLS follows the same two-layer convention as 001_initial.sql: the backend's
-- service_role key bypasses RLS in Supabase by design (application code is
-- the primary enforcement layer), and an `authenticated`-role policy scoped
-- to the row's owner is a second layer for the case where Supabase is
-- configured to trust Clerk's JWKS as a Postgres JWT issuer.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_audit_logs"
  ON audit_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users_own_audit_logs" ON audit_logs
  FOR SELECT
  TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'));
