/**
 * @file answerValidator.ts
 * @description Post-hoc answer validation — after an SSE stream has already
 *              completed and been shown to the user, an async Groq call checks
 *              the generated answer against the chunks it was built from and
 *              flags hallucinations/contradictions/unsupported claims. Never
 *              runs on the request path: validating before streaming would add
 *              a full extra LLM round-trip of latency before the user sees
 *              anything, defeating the point of streaming. Callers must treat
 *              this as fire-and-forget and persist the result via
 *              setQueryValidation for later display (e.g. a confidence badge
 *              on query history) rather than blocking on it.
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from '../utils/logger.js';
import { getGroqClient } from './llm.js';
import type { RetrievedChunk } from '../types/index.js';

// ─── Configuration ─────────────────────────────────────────────────────────────

const VALIDATION_CONFIG = {
  // Same fast model used for generation (ADR-005) — this is a background
  // check, not a user-facing reasoning task, so the 70b model isn't worth
  // the extra latency/cost on Groq's free tier.
  model: 'llama-3.1-8b-instant',
  temperature: 0.1,
  maxTokens: 512,
  minConfidence: 0.6,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: ValidationIssue[];
  suggestions: string[];
  durationMs: number;
}

export interface ValidationIssue {
  type:
    | 'hallucination'
    | 'contradiction'
    | 'unsupported_claim'
    | 'missing_citation'
    | 'inconsistency';
  severity: 'low' | 'medium' | 'high';
  message: string;
  context?: string;
}

/** Shape expected back from the validation model's JSON response. */
interface RawValidationResponse {
  issues?: Array<{
    type?: string;
    severity?: string;
    message?: string;
    context?: string;
  }>;
  confidence?: number;
  suggestions?: string[];
}

// ─── Validation Prompt ───────────────────────────────────────────────────────────

const VALIDATION_SYSTEM_PROMPT = `You are an expert fact-checker and answer validator. Your task is to validate whether a generated answer is supported by the provided retrieved context chunks.

Analyze the answer and check for:
1. Hallucinations: Claims not present in the context
2. Contradictions: Claims that directly contradict the context
3. Unsupported claims: Specific facts, figures, or details not found in the context
4. Missing citations: Important claims that should reference specific chunks but don't
5. Inconsistencies: Internal contradictions within the answer itself

For each issue found, provide the type, severity (low/medium/high), a brief message, and the problematic text as context.

Finally, provide an overall confidence score (0-1) indicating how well the answer is supported by the context.

Respond in JSON format with this structure:
{
  "issues": [
    { "type": "issue_type", "severity": "severity", "message": "description", "context": "problematic text" }
  ],
  "confidence": 0.85,
  "suggestions": ["suggestion1", "suggestion2"]
}`;

const VALID_ISSUE_TYPES = new Set<ValidationIssue['type']>([
  'hallucination',
  'contradiction',
  'unsupported_claim',
  'missing_citation',
  'inconsistency',
]);
const VALID_SEVERITIES = new Set<ValidationIssue['severity']>(['low', 'medium', 'high']);

/**
 * Narrows a raw parsed issue from the model's JSON response into a typed
 * ValidationIssue, defaulting any unrecognized/missing field rather than
 * trusting the model's output shape.
 * @param raw - One issue entry from the parsed JSON response
 * @returns A well-typed ValidationIssue
 */
function normalizeIssue(
  raw: NonNullable<RawValidationResponse['issues']>[number],
): ValidationIssue {
  const type = VALID_ISSUE_TYPES.has(raw.type as ValidationIssue['type'])
    ? (raw.type as ValidationIssue['type'])
    : 'unsupported_claim';
  const severity = VALID_SEVERITIES.has(raw.severity as ValidationIssue['severity'])
    ? (raw.severity as ValidationIssue['severity'])
    : 'medium';

  const issue: ValidationIssue = {
    type,
    severity,
    message: raw.message ?? 'Unspecified issue',
  };
  if (raw.context !== undefined) issue.context = raw.context;
  return issue;
}

// ─── Validation Functions ───────────────────────────────────────────────────────

/**
 * Validates an answer against the chunks it was generated from, via an async
 * Groq call. Must only be invoked after the answer has already been streamed
 * to the user — never on the request-blocking path.
 * @param query - The original user query
 * @param answer - The already-streamed generated answer
 * @param chunks - Retrieved context chunks the answer was generated from
 * @returns Validation result with confidence and issues; fails open (isValid: true) on any error
 */
export async function validateAnswer(
  query: string,
  answer: string,
  chunks: RetrievedChunk[],
): Promise<ValidationResult> {
  const startTime = Date.now();

  if (chunks.length === 0) {
    return { isValid: true, confidence: 1.0, issues: [], suggestions: [], durationMs: 0 };
  }

  try {
    const contextText = chunks
      .map((chunk, index) => `[Chunk ${index + 1}]: ${chunk.content}`)
      .join('\n\n');

    const userPrompt = `Query: ${query}\n\nAnswer: ${answer}\n\nContext:\n${contextText}\n\nValidate this answer against the provided context. Respond in JSON format.`;

    const groq = getGroqClient();

    const response = await groq.chat.completions.create({
      model: VALIDATION_CONFIG.model,
      messages: [
        { role: 'system', content: VALIDATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: VALIDATION_CONFIG.temperature,
      max_tokens: VALIDATION_CONFIG.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from validation model');
    }

    const validationData = JSON.parse(content) as RawValidationResponse;

    const issues: ValidationIssue[] = (validationData.issues ?? []).map(normalizeIssue);
    const confidence = validationData.confidence ?? 0.5;
    const suggestions = validationData.suggestions ?? [];
    const isValid = confidence >= VALIDATION_CONFIG.minConfidence;

    const durationMs = Date.now() - startTime;

    logger.info('Answer validation completed', {
      isValid,
      confidence,
      issueCount: issues.length,
      highSeverityIssues: issues.filter((i) => i.severity === 'high').length,
      durationMs,
    });

    return { isValid, confidence, issues, suggestions, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.warn('Answer validation failed, treating as unvalidated', {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    // Fail open — a failed validation call must never retroactively affect an
    // answer the user has already received.
    return { isValid: true, confidence: 0.5, issues: [], suggestions: [], durationMs };
  }
}

/**
 * Generates a short validation summary string for logging.
 * @param result - A completed ValidationResult
 * @returns One-line human-readable summary
 */
export function generateValidationSummary(result: ValidationResult): string {
  if (result.isValid) {
    return `Valid (confidence: ${result.confidence.toFixed(2)})`;
  }

  const highSeverityIssues = result.issues.filter((i) => i.severity === 'high');
  const mediumSeverityIssues = result.issues.filter((i) => i.severity === 'medium');

  return `Invalid (confidence: ${result.confidence.toFixed(2)}, ${highSeverityIssues.length} high, ${mediumSeverityIssues.length} medium issues)`;
}
