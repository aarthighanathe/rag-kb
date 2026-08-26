/**
 * @file queryRewriter.ts
 * @description Optional HyDE-lite query rewriting — reformulates a user's question into
 *   a short passage-like statement before it's embedded, to compensate for
 *   all-MiniLM-L6-v2's documented weakness at asymmetric question/passage retrieval
 *   (see supabase/migrations/001_initial.sql's match_chunks comments). Gated behind
 *   env.QUERY_REWRITE_ENABLED so it can be A/B tested against the baseline rather than
 *   switched on unconditionally — it adds one extra Groq call (latency + cost) per query.
 *   When conversation history is available, the same call also resolves references
 *   to prior turns (contextual retrieval) — e.g. "what about pricing?" following a
 *   question about a specific product becomes a self-contained statement naming that
 *   product, so the embedding step searches for what the user actually means instead
 *   of the literal (context-free) follow-up text.
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getGroqClient } from './llm.js';

const MODEL_ID = 'llama-3.1-8b-instant';

/** Low temperature and a small token budget — this is a short reformulation, not an answer. */
const REWRITE_TEMPERATURE = 0.2;
const REWRITE_MAX_TOKENS = 128;

/** Hard timeout so a slow rewrite call never meaningfully delays the actual query. */
const REWRITE_TIMEOUT_MS = 5_000;

/** How many trailing history turns to fold into the rewrite prompt — enough for one exchange of context without growing the prompt unboundedly. */
const MAX_HISTORY_TURNS_FOR_REWRITE = 4;

/** Minimal shape needed from a conversation turn — matches QueryRequest['history'] without importing the Zod schema module into this service. */
export interface RewriteHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const REWRITE_SYSTEM_PROMPT = [
  "You rewrite a user's question into a short, self-contained, factual statement",
  'that a relevant passage from a knowledge base might contain, to improve semantic',
  'search retrieval.',
  'Rules:',
  '- Output ONLY the rewritten statement. No preamble, no explanation, no quotes.',
  '- Keep it short — one or two sentences.',
  '- Preserve all specific terms, names, and numbers from the original question exactly.',
  '- Do not answer the question or add information not implied by it.',
  '- If prior conversation turns are provided, resolve any pronoun or implicit',
  '  reference in the current question (e.g. "it", "that", "what about X") using',
  '  the most recent relevant subject from those turns, so the rewritten statement',
  '  is understandable on its own without the conversation history.',
].join('\n');

/**
 * Formats the trailing history turns as plain text for the rewrite prompt.
 * Deliberately not reusing llm.ts's buildContextString/history formatting —
 * this is a much shorter, single-purpose prompt (a labeled turn list, not the
 * full untrusted-context wrapper used for actual answer generation).
 * @param history - Full conversation history from the request
 * @returns Formatted turn list, or an empty string if there's no history
 */
function formatHistoryForRewrite(history: RewriteHistoryTurn[]): string {
  if (history.length === 0) return '';
  const recent = history.slice(-MAX_HISTORY_TURNS_FOR_REWRITE);
  return recent
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

/**
 * Rewrites a user query into a passage-like statement via a cheap Groq call,
 * for use as the text that gets embedded instead of the raw question. When
 * `history` is non-empty, the rewrite also resolves references to prior turns
 * so a context-dependent follow-up becomes a self-contained retrieval query.
 * Falls back to the original query text on any failure (timeout, API error,
 * empty/invalid response) — a failed rewrite must never block or fail the
 * underlying query, only forgo the (unproven) retrieval benefit.
 * @param query - The user's original, already-sanitised question
 * @param history - Optional prior conversation turns, most recent last
 * @returns The rewritten passage-like statement, or the original query on failure
 */
export async function rewriteQueryForRetrieval(
  query: string,
  history: RewriteHistoryTurn[] = [],
): Promise<string> {
  if (!env.QUERY_REWRITE_ENABLED) return query;

  try {
    const historyBlock = formatHistoryForRewrite(history);
    const userContent = historyBlock
      ? `Conversation so far:\n${historyBlock}\n\nCurrent question: ${query}`
      : query;

    const completion = await getGroqClient().chat.completions.create(
      {
        model: MODEL_ID,
        temperature: REWRITE_TEMPERATURE,
        max_tokens: REWRITE_MAX_TOKENS,
        messages: [
          { role: 'system', content: REWRITE_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      },
      // Use groq-sdk's built-in per-request timeout instead of a hand-rolled
      // AbortController/setTimeout, which removes the manual timer lifecycle.
      { timeout: REWRITE_TIMEOUT_MS },
    );

    const rewritten = completion.choices[0]?.message.content?.trim();
    if (!rewritten) {
      logger.warn('Query rewrite returned empty content, falling back to original query');
      return query;
    }
    return rewritten;
  } catch (err) {
    logger.warn('Query rewrite failed, falling back to original query', {
      error: err instanceof Error ? err.message : String(err),
    });
    return query;
  }
}
