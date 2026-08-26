/**
 * @file env.test.ts
 * @description Unit tests for the Zod-validated environment config — valid
 *   env passes through typed/coerced, and specific invalid/missing vars fail
 *   fast (process.exit(1)) rather than running with a partial config.
 * @author [Author Placeholder]
 * @created 2026-08-24
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A full, valid environment matching every var env.ts requires — mirrors
// tests/setup.ts's global values, kept local here so each test can mutate a
// copy without affecting the module-level env.ts already loaded by every
// other test file in this run.
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    GROQ_API_KEY: 'test-groq-key',
    HUGGINGFACE_TOKEN: 'test-hf-token',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-supabase-key',
    REDIS_URL: 'redis://localhost:6379',
    PORT: '3001',
    CORS_ORIGIN: 'http://localhost:5173',
    MAX_FILE_SIZE_MB: '10',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_UPLOAD: '5',
    RATE_LIMIT_MAX_QUERY: '30',
    RATE_LIMIT_MAX_DOCUMENTS: '100',
    LOG_LEVEL: 'error',
    ADMIN_SECRET: 'test-admin-secret-at-least-32-characters-long',
    CLERK_SECRET_KEY: 'test-clerk-secret-key',
    CLERK_PUBLISHABLE_KEY: 'test-clerk-publishable-key',
  };
}

const ENV_KEYS = Object.keys(validEnv());

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  // Restore exactly the keys env.ts cares about — this file's tests mutate
  // process.env directly (env.ts reads it at import time, before any mock
  // could intercept), so a full restore prevents leaking a broken env into
  // later test files' module cache (already-loaded modules keep their own
  // captured `env` object regardless, but this keeps process.env itself clean
  // for anything that reads it directly, e.g. NODE_ENV checks elsewhere).
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.restoreAllMocks();
});

/**
 * Loads env.ts fresh against the given process.env overrides, with
 * process.exit and stderr mocked so a validation failure doesn't kill the
 * test runner. process.exit is mocked to throw — env.ts's top-level code
 * calls it synchronously right after writing to stderr, so throwing lets the
 * dynamic import's rejection carry the "did it fail" signal back to the test
 * without actually terminating the process.
 * @param overrides - process.env values to apply on top of a fully valid baseline
 * @returns Object with the mocked exit/stderr spies and either the loaded module or the caught error
 */
async function loadEnvWith(overrides: Record<string, string | undefined>) {
  const base = validEnv();
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) called`);
    }) as never);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  try {
    const mod = await import('../../src/config/env');
    return { exitSpy, stderrSpy, mod, error: undefined as unknown };
  } catch (error) {
    return { exitSpy, stderrSpy, mod: undefined as typeof import('../../src/config/env') | undefined, error };
  }
}

describe('env — valid configuration', () => {
  it('loads successfully and exposes typed/coerced values', async () => {
    const { mod, exitSpy } = await loadEnvWith({});
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod?.env.NODE_ENV).toBe('test');
    expect(mod?.env.PORT).toBe(3001);
    expect(typeof mod?.env.PORT).toBe('number');
  });

  it('applies documented defaults for optional vars', async () => {
    const { mod, exitSpy } = await loadEnvWith({
      PORT: undefined,
      MAX_FILE_SIZE_MB: undefined,
      RATE_LIMIT_WINDOW_MS: undefined,
      LOG_LEVEL: undefined,
      QUERY_REWRITE_ENABLED: undefined,
      CROSS_ENCODER_ENABLED: undefined,
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod?.env.PORT).toBe(3000);
    expect(mod?.env.MAX_FILE_SIZE_MB).toBe(10);
    expect(mod?.env.RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(mod?.env.LOG_LEVEL).toBe('info');
    expect(mod?.env.QUERY_REWRITE_ENABLED).toBe(false);
    expect(mod?.env.CROSS_ENCODER_ENABLED).toBe(true);
  });

  it('coerces the boolean-flag env vars from the literal string "true"', async () => {
    const { mod, exitSpy } = await loadEnvWith({
      QUERY_REWRITE_ENABLED: 'true',
      CROSS_ENCODER_ENABLED: 'false',
    });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(mod?.env.QUERY_REWRITE_ENABLED).toBe(true);
    expect(mod?.env.CROSS_ENCODER_ENABLED).toBe(false);
  });
});

describe('env — missing required secrets fail fast', () => {
  it.each([
    'GROQ_API_KEY',
    'HUGGINGFACE_TOKEN',
    'SUPABASE_SERVICE_KEY',
    'ADMIN_SECRET',
    'CLERK_SECRET_KEY',
    'CLERK_PUBLISHABLE_KEY',
  ])('exits when %s is missing', async (key) => {
    const { exitSpy, stderrSpy } = await loadEnvWith({ [key]: undefined });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('exits when NODE_ENV is unset (no default, unlike most other vars)', async () => {
    const { exitSpy } = await loadEnvWith({ NODE_ENV: undefined });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when NODE_ENV is not one of the allowed values', async () => {
    const { exitSpy } = await loadEnvWith({ NODE_ENV: 'staging' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when CORS_ORIGIN is unset (no default)', async () => {
    const { exitSpy } = await loadEnvWith({ CORS_ORIGIN: undefined });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('env — malformed values fail fast', () => {
  it('exits when SUPABASE_URL is not a valid URL', async () => {
    const { exitSpy } = await loadEnvWith({ SUPABASE_URL: 'not-a-url' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when REDIS_URL is not a valid URL', async () => {
    const { exitSpy } = await loadEnvWith({ REDIS_URL: 'not-a-url' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when CORS_ORIGIN is not a valid URL', async () => {
    const { exitSpy } = await loadEnvWith({ CORS_ORIGIN: 'not-a-url' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when PORT is out of the valid 1-65535 range', async () => {
    const { exitSpy } = await loadEnvWith({ PORT: '99999' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when MAX_FILE_SIZE_MB is not a positive number', async () => {
    const { exitSpy } = await loadEnvWith({ MAX_FILE_SIZE_MB: 'not-a-number' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when ADMIN_SECRET is shorter than 32 characters', async () => {
    const { exitSpy } = await loadEnvWith({ ADMIN_SECRET: 'too-short' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('writes the formatted validation errors to stderr before exiting', async () => {
    const { stderrSpy } = await loadEnvWith({ GROQ_API_KEY: undefined });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid environment variables'),
    );
  });
});
