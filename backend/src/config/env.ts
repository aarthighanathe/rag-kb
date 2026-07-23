/**
 * @file env.ts
 * @description Zod-validated environment configuration — single source of truth for all env vars
 *
 * Security guarantees:
 *  - All required secrets are validated at startup (fail-fast).
 *  - process.exit(1) on any missing or malformed var — never run with a partial config.
 *  - Consumers import `env` (typed) not process.env (untyped string | undefined).
 *  - Secrets are never logged — only presence/absence is recorded.
 *
 * Threat: A02 Cryptographic Failures, A05 Security Misconfiguration — running without
 * required secrets could cause silent failures or expose default/empty credentials.
 *
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ── External API secrets (required — no defaults) ──────────────────────────
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  HUGGINGFACE_TOKEN: z.string().min(1, 'HUGGINGFACE_TOKEN is required'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),

  // ── Server config (safe defaults) ─────────────────────────────────────────
  PORT: z
    .string()
    .default('3000')
    .transform((v) => parseInt(v, 10))
    .refine((v) => v > 0 && v < 65536, 'PORT must be between 1 and 65535'),
  // No default: an unset NODE_ENV in a deploy host must fail fast at boot
  // rather than silently run with dev-mode error verbosity, wide-open CORS,
  // and non-JSON logs (see errorHandler.ts, security.ts, logger.ts).
  NODE_ENV: z.enum(['development', 'production', 'test'], {
    errorMap: () => ({
      message: "NODE_ENV is required and must be 'development', 'production', or 'test'",
    }),
  }),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Must be a full URL. Requests from any other origin are rejected. No
  // default: unlike a fallback that silently enforces CORS against
  // localhost, an unset value in production would look like a frontend bug
  // (every real browser request blocked) rather than a missing env var —
  // fail fast at boot instead, matching the other required secrets above.
  CORS_ORIGIN: z.string().url('CORS_ORIGIN is required and must be a valid URL'),

  // ── File upload limits ────────────────────────────────────────────────────
  MAX_FILE_SIZE_MB: z
    .string()
    .default('10')
    .transform((v) => parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v > 0, 'MAX_FILE_SIZE_MB must be a positive number'),

  // ── Rate limiting (all per RATE_LIMIT_WINDOW_MS window) ──────────────────
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default('60000')
    .transform((v) => parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v > 0, 'RATE_LIMIT_WINDOW_MS must be a positive number'),
  /** Max uploads per IP per window. Each upload triggers HuggingFace API calls. */
  RATE_LIMIT_MAX_UPLOAD: z
    .string()
    .default('5')
    .transform((v) => parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v > 0, 'RATE_LIMIT_MAX_UPLOAD must be a positive number'),
  /** Max queries per IP per window. Each query triggers HuggingFace + Groq. */
  RATE_LIMIT_MAX_QUERY: z
    .string()
    .default('30')
    .transform((v) => parseInt(v, 10))
    .refine((v) => Number.isFinite(v) && v > 0, 'RATE_LIMIT_MAX_QUERY must be a positive number'),
  /** Max document list/delete requests per IP per window. Protects against enumeration. */
  RATE_LIMIT_MAX_DOCUMENTS: z
    .string()
    .default('100')
    .transform((v) => parseInt(v, 10))
    .refine(
      (v) => Number.isFinite(v) && v > 0,
      'RATE_LIMIT_MAX_DOCUMENTS must be a positive number',
    ),

  // ── Admin authentication ──────────────────────────────────────────────────
  // Passed via X-Admin-Secret header. Must be set explicitly — no default.
  ADMIN_SECRET: z.string().min(32, 'ADMIN_SECRET must be at least 32 characters'),

  // ── Authentication (Clerk) ────────────────────────────────────────────────
  // Used by requireAuth middleware to verify JWTs issued by Clerk (Google OAuth).
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
});

export type Env = z.infer<typeof envSchema>;

// ─── Validation ───────────────────────────────────────────────────────────────

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  const formatted = parseResult.error.format();
  // process.stderr.write used deliberately here: Winston logger is not yet initialised
  // (it depends on LOG_LEVEL from this very module), so console.* is not available.
  process.stderr.write(
    `❌ Invalid environment variables:\n${JSON.stringify(formatted, null, 2)}\n\nCheck your .env file.\n`,
  );
  process.exit(1);
}

/** Validated, typed environment configuration. Import this instead of process.env directly. */
export const env: Env = parseResult.data;
