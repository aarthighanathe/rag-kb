/**
 * @file localReranker.ts
 * @description Local re-ranking of retrieved chunks — no extra network call, and NOT a
 *              cross-encoder model (renamed from crossEncoder.ts, which implied an actual
 *              ML re-ranker; this is a cheaper heuristic). Blends each chunk's existing
 *              vector/keyword similarity with a term-overlap score (BM25-lite) computed
 *              against the raw query, so exact keyword matches that pgvector's cosine
 *              distance alone under-weights get pulled back up before generation sees them.
 *              A real cross-encoder model call remains a possible future upgrade — see
 *              FEATURES.md §3.1a.
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import type { RetrievedChunk } from '../types/index.js';

// ─── Configuration ─────────────────────────────────────────────────────────────

const RERANK_CONFIG = {
  /** Weight given to the term-overlap signal vs. the original similarity score (0-1). */
  overlapWeight: 0.35,
  /** Chunks below this length (chars) get a small penalty — fragments rarely carry full answers. */
  minUsefulLength: 80,
} as const;

/**
 * Practical ceilings used to normalize each chunk's raw similarity onto a
 * comparable 0-1 scale before blending with the term-overlap score. Vector
 * (MiniLM cosine) and keyword (pg_trgm) similarity are NOT the same metric —
 * vector scores for a strong match top out around ~0.40, while pg_trgm
 * scores range up to 1.0 — so blending them unnormalized systematically
 * over-boosts keyword-sourced chunks relative to vector-sourced ones. These
 * mirror the ceilings implied by llm.ts's RELEVANCE_BAND_THRESHOLDS /
 * KEYWORD_BAND_THRESHOLDS bands (kept local here to avoid importing the
 * prompt-building module into the reranker).
 */
const SIMILARITY_CEILING = {
  vector: 0.4,
  keyword: 1.0,
} as const;

/**
 * Normalizes a chunk's raw similarity onto a 0-1 "relative strength" scale
 * using its source's practical ceiling, so vector and keyword chunks are
 * comparable before blending with the term-overlap score.
 * @param similarity - Raw similarity score as returned by hybridSearch
 * @param source - Which retrieval leg produced this score
 * @returns Normalized score, clamped to [0, 1]
 */
function normalizeSimilarity(similarity: number, source: RetrievedChunk['source']): number {
  const ceiling = SIMILARITY_CEILING[source];
  return Math.min(1, Math.max(0, similarity / ceiling));
}

export interface RerankResult {
  chunks: RetrievedChunk[];
  reranked: boolean;
  originalCount: number;
  rerankedCount: number;
  durationMs: number;
}

interface ScoredChunk {
  chunk: RetrievedChunk;
  score: number;
}

// ─── Term overlap scoring ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'and',
  'or',
  'but',
  'if',
  'what',
  'when',
  'where',
  'who',
  'how',
  'why',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'by',
]);

/**
 * Tokenizes text into lowercase, stopword-free terms for overlap scoring.
 * @param text - Raw text
 * @returns Array of significant lowercase terms
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Scores how well a chunk's content covers the query's terms, weighted by
 * term frequency within the chunk (more mentions of a query term ranks higher,
 * capped to avoid keyword-stuffed chunks dominating).
 * @param queryTerms - Tokenized, de-duplicated query terms
 * @param content - Chunk content to score against
 * @returns Normalized overlap score in [0, 1]
 */
function termOverlapScore(queryTerms: string[], content: string): number {
  if (queryTerms.length === 0) return 0;

  const contentTerms = tokenize(content);
  if (contentTerms.length === 0) return 0;

  const contentCounts = new Map<string, number>();
  for (const term of contentTerms) {
    contentCounts.set(term, (contentCounts.get(term) ?? 0) + 1);
  }

  let matched = 0;
  for (const term of queryTerms) {
    const count = contentCounts.get(term) ?? 0;
    if (count > 0) matched += Math.min(count, 3) / 3; // diminishing returns per term
  }

  return matched / queryTerms.length;
}

/**
 * Re-ranks retrieved chunks using a local blend of their existing similarity
 * score and query-term overlap. This never calls an external API — it only
 * reorders/trims the chunks the caller already retrieved via similaritySearch.
 * @param query - The user's original query text
 * @param chunks - Chunks already retrieved via vector/hybrid search
 * @param topK - Number of chunks to return after re-ranking
 * @returns Re-ranked (or pass-through, if disabled) result
 */
export function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topK: number = 5,
): RerankResult {
  const startTime = Date.now();
  const originalCount = chunks.length;

  if (!env.CROSS_ENCODER_ENABLED || chunks.length === 0) {
    return {
      chunks: chunks.slice(0, topK),
      reranked: false,
      originalCount,
      rerankedCount: Math.min(chunks.length, topK),
      durationMs: 0,
    };
  }

  const queryTerms = [...new Set(tokenize(query))];

  const scored: ScoredChunk[] = chunks.map((chunk) => {
    const overlap = termOverlapScore(queryTerms, chunk.content);
    const lengthPenalty = chunk.content.length < RERANK_CONFIG.minUsefulLength ? 0.9 : 1;
    const normalizedSimilarity = normalizeSimilarity(chunk.similarity, chunk.source);
    const blended =
      (1 - RERANK_CONFIG.overlapWeight) * normalizedSimilarity +
      RERANK_CONFIG.overlapWeight * overlap;

    return { chunk, score: blended * lengthPenalty };
  });

  scored.sort((a, b) => b.score - a.score);

  const rerankedChunks = scored.slice(0, topK).map((s) => s.chunk);
  const durationMs = Date.now() - startTime;

  logger.debug('Local re-ranking applied', {
    originalCount,
    rerankedCount: rerankedChunks.length,
    durationMs,
    topScores: scored.slice(0, 3).map((s) => s.score.toFixed(3)),
  });

  return {
    chunks: rerankedChunks,
    reranked: true,
    originalCount,
    rerankedCount: rerankedChunks.length,
    durationMs,
  };
}
