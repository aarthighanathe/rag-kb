/**
 * @file readiness.ts
 * @description Dependency health checks (Supabase, Redis) backing the /api/health readiness endpoint
 * @author [Author Placeholder]
 * @created 2026-07-23
 */

import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { getQueue } from '../queues/documentQueue.js';
import { logger } from '../utils/logger.js';

/** Per-dependency check timeout — keeps a hung dependency from hanging the health endpoint itself. */
const CHECK_TIMEOUT_MS = 3_000;

/** HuggingFace model info endpoint — metadata only, does not invoke inference (no compute cost per poll). */
const HF_MODEL_INFO_URL = 'https://huggingface.co/api/models/sentence-transformers/all-MiniLM-L6-v2';

/** Status of a single dependency check. */
export interface DependencyCheck {
  status: 'ok' | 'error';
  error?: string;
}

/** Aggregate readiness result. */
export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: {
    supabase: DependencyCheck;
    redis: DependencyCheck;
    huggingface: DependencyCheck;
    groq: DependencyCheck;
  };
}

let _readinessClient: ReturnType<typeof createClient> | null = null;

/** Lazily-created lightweight Supabase client dedicated to readiness pings. */
function getReadinessClient(): ReturnType<typeof createClient> {
  if (!_readinessClient) {
    _readinessClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _readinessClient;
}

/**
 * Races a promise against a timeout so a single hung dependency can't block the health endpoint.
 * @param promise - The check to bound
 * @param label - Dependency name, used in the timeout error message
 */
function withCheckTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} check timed out after ${CHECK_TIMEOUT_MS}ms`));
    }, CHECK_TIMEOUT_MS);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Pings Supabase with a minimal, cheap query to confirm connectivity.
 * @returns 'ok' or 'error' with a short message
 */
async function checkSupabase(): Promise<DependencyCheck> {
  try {
    const query = getReadinessClient()
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    const { error } = await withCheckTimeout(Promise.resolve(query), 'Supabase');
    if (error) return { status: 'error', error: error.message };
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Confirms Redis connectivity and auth via the same connection BullMQ uses.
 * `INFO` is used as the round-trip probe (rather than `PING`, which BullMQ's
 * client abstraction does not expose) — like PING it requires a live,
 * authenticated connection, so a `NOAUTH`/connection failure surfaces the
 * same way.
 * @returns 'ok' or 'error' with a short message
 */
async function checkRedis(): Promise<DependencyCheck> {
  try {
    const client = await withCheckTimeout(getQueue().client, 'Redis');
    await withCheckTimeout(client.info(), 'Redis INFO');
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Confirms the HuggingFace token is valid and the embedding model is reachable
 * via the public model-info endpoint — metadata only, so this does not invoke
 * inference and costs nothing per poll (unlike calling embedText, which would
 * hit the real feature-extraction endpoint on every health check).
 * @returns 'ok' or 'error' with a short message
 */
async function checkHuggingFace(): Promise<DependencyCheck> {
  try {
    const response = await withCheckTimeout(
      fetch(HF_MODEL_INFO_URL, {
        headers: { Authorization: `Bearer ${env.HUGGINGFACE_TOKEN}` },
      }),
      'HuggingFace',
    );
    if (!response.ok) {
      return { status: 'error', error: `HuggingFace model-info returned ${response.status}` };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Confirms the Groq API key is valid and the API is reachable via `models.list()`
 * — a metadata call, not a completion request, so it costs no inference tokens
 * per poll.
 * @returns 'ok' or 'error' with a short message
 */
async function checkGroq(): Promise<DependencyCheck> {
  try {
    const groq = new Groq({ apiKey: env.GROQ_API_KEY });
    await withCheckTimeout(groq.models.list(), 'Groq');
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Runs all dependency checks in parallel and aggregates the result.
 * @returns Overall status ('ok' only if every dependency is 'ok') plus per-dependency detail
 */
export async function checkReadiness(): Promise<ReadinessResult> {
  const [supabase, redis, huggingface, groq] = await Promise.all([
    checkSupabase(),
    checkRedis(),
    checkHuggingFace(),
    checkGroq(),
  ]);
  const status =
    supabase.status === 'ok' && redis.status === 'ok' && huggingface.status === 'ok' && groq.status === 'ok'
      ? 'ok'
      : 'error';

  if (status === 'error') {
    logger.warn('Readiness check failed', { supabase, redis, huggingface, groq });
  }

  return { status, checks: { supabase, redis, huggingface, groq } };
}
