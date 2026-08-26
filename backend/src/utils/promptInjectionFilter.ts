/**
 * @file promptInjectionFilter.ts
 * @description Prompt injection detection and filtering for user queries
 * @author [Author Placeholder]
 * @created 2026-08-23
 */

import { logger } from './logger.js';

/**
 * Common prompt injection patterns to detect
 * These are patterns that attackers use to bypass system prompts
 */
const INJECTION_PATTERNS = [
  // Direct instructions to ignore previous instructions
  /ignore\s+(all\s+)?(previous|above|system|the\s+)?instructions?/gi,
  /forget\s+(everything|all\s+instructions|previous\s+instructions)/gi,
  /disregard\s+(all\s+)?(previous|above|system)?\s*instructions?/gi,

  // Role manipulation attempts
  /act\s+as\s+(a\s+)?(different|new|another)/gi,
  /you\s+are\s+now\s+(a\s+)?/gi,
  /pretend\s+(to\s+be|you\s+are)/gi,
  /roleplay\s+as/gi,
  /switch\s+roles?/gi,

  // System prompt extraction attempts
  /repeat\s+(the\s+)?(above|previous|system)?\s*(instructions|prompt|text)/gi,
  /show\s+(me\s+)?(your\s+)?(instructions|prompt|system\s+prompt)/gi,
  /print\s+(the\s+)?(above|previous|system)?\s*(instructions|prompt)/gi,
  /output\s+(your\s+)?(instructions|prompt)/gi,
  /what\s+(are\s+)?your\s+instructions?/gi,
  /tell\s+me\s+(your\s+)?(instructions|prompt)/gi,

  // Context manipulation
  /start\s+(a\s+)?new\s+conversation/gi,
  /clear\s+(the\s+)?(context|history|memory)/gi,
  /reset\s+(the\s+)?(context|history|memory)/gi,
  /forget\s+(the\s+)?(context|history|conversation)/gi,

  // Output format manipulation
  /output\s+(in\s+)?(json|xml|yaml|markdown|code|raw|plain\s+text)/gi,
  /format\s+(your\s+)?(output|response)\s+as/gi,
  /respond\s+(in\s+)?(json|xml|yaml|code)/gi,
  /return\s+(only\s+)?(json|xml|yaml)/gi,

  // Bypass attempts
  /bypass\s+(the\s+)?(restrictions|rules|filters)/gi,
  /override\s+(the\s+)?(restrictions|rules|instructions)/gi,
  /disable\s+(the\s+)?(restrictions|rules|filters)/gi,
  /ignore\s+(the\s+)?(restrictions|rules)/gi,

  // Jailbreak patterns
  /jailbreak/gi,
  /dan\s+(mode|version)/gi,
  /developer\s+mode/gi,
  /admin\s+mode/gi,
  /unrestricted\s+mode/gi,
  /god\s+mode/gi,

  // Code execution attempts
  /execute\s+(the\s+)?(following|this)?\s*(code|command|script)/gi,
  /run\s+(this\s+)?(code|command|script)/gi,

  // External system access
  /access\s+(the\s+)?(internet|web|external\s+system)/gi,
  /search\s+(the\s+)?(internet|web)/gi,
  /browse\s+(the\s+)?(internet|web)/gi,
];

/**
 * Suspicious keywords that may indicate injection attempts
 * These are less specific but can be combined with other patterns
 */
const SUSPICIOUS_KEYWORDS = [
  'instructions',
  'prompt',
  'system',
  'override',
  'bypass',
  'ignore',
  'disregard',
  'forget',
  'reset',
  'clear',
  'developer',
  'admin',
  'unrestricted',
  'jailbreak',
  'execute',
  'run',
  'code',
  'script',
  'command',
];

/**
 * Result of prompt injection check
 */
export interface InjectionCheckResult {
  isDetected: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  matchedPatterns: string[];
  sanitizedQuery: string;
  reason: string;
}

/**
 * Bumps a risk level up to 'medium', unless it is already 'high'.
 * @param riskLevel - The current risk level
 * @returns 'high' if already high, otherwise 'medium'
 */
function escalateToMedium(riskLevel: 'low' | 'medium' | 'high'): 'medium' | 'high' {
  return riskLevel === 'high' ? 'high' : 'medium';
}

/**
 * Determines whether a matched pattern's source indicates high risk
 * (jailbreak/developer-mode/admin-mode style attempts).
 * @param patternSource - The `.source` of a matched injection pattern
 * @returns `true` if the pattern indicates high risk
 */
function isHighRiskPattern(patternSource: string): boolean {
  return (
    patternSource.includes('jailbreak') ||
    patternSource.includes('developer') ||
    patternSource.includes('admin')
  );
}

/**
 * Determines whether a matched pattern's source indicates medium risk
 * (ignore/override/bypass style attempts).
 * @param patternSource - The `.source` of a matched injection pattern
 * @returns `true` if the pattern indicates medium risk
 */
function isMediumRiskPattern(patternSource: string): boolean {
  return (
    patternSource.includes('ignore') ||
    patternSource.includes('override') ||
    patternSource.includes('bypass')
  );
}

/**
 * Tests a query against all known injection patterns, collecting the matched
 * pattern sources and the resulting risk level.
 * @param query - The user's query text
 * @returns The matched pattern sources and the risk level they imply
 */
function matchInjectionPatterns(query: string): {
  matchedPatterns: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const matchedPatterns: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(query)) {
      matchedPatterns.push(pattern.source);

      // Determine risk level based on pattern severity
      if (isHighRiskPattern(pattern.source)) {
        riskLevel = 'high';
      } else if (isMediumRiskPattern(pattern.source)) {
        riskLevel = escalateToMedium(riskLevel);
      }
    }
  }

  return { matchedPatterns, riskLevel };
}

/**
 * Counts how many suspicious keywords appear in the query (case-insensitive).
 * @param query - The user's query text
 * @returns Number of distinct suspicious keywords found
 */
function countSuspiciousKeywords(query: string): number {
  return SUSPICIOUS_KEYWORDS.filter((keyword) => query.toLowerCase().includes(keyword)).length;
}

/**
 * Removes all known injection patterns from the query and collapses whitespace,
 * falling back to a placeholder if sanitization removes everything.
 * @param query - The original query text
 * @returns The sanitized query text
 */
function sanitizeQuery(query: string): string {
  let sanitizedQuery = query;
  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    sanitizedQuery = sanitizedQuery.replace(pattern, '');
  }

  // Clean up extra whitespace from pattern removal
  sanitizedQuery = sanitizedQuery.replace(/\s+/g, ' ').trim();

  // If sanitization removed everything, return a placeholder
  if (sanitizedQuery.length === 0) {
    sanitizedQuery = '[Query removed due to security concerns]';
  }

  return sanitizedQuery;
}

/**
 * Builds the human-readable reason string for a detection outcome.
 * @param isDetected - Whether an injection attempt was detected
 * @param riskLevel - The computed risk level
 * @returns A reason string, or an empty string if nothing was detected
 */
function buildDetectionReason(isDetected: boolean, riskLevel: 'low' | 'medium' | 'high'): string {
  if (!isDetected) {
    return '';
  }

  if (riskLevel === 'high') {
    return 'Query contains high-risk prompt injection patterns and has been sanitized.';
  }

  if (riskLevel === 'medium') {
    return 'Query contains suspicious patterns that may indicate prompt injection attempts.';
  }

  return 'Query contains potential injection indicators.';
}

/**
 * Checks a user query for potential prompt injection attempts
 * @param query - The user's query text
 * @returns Injection check result with risk level and sanitized query
 */
export function checkPromptInjection(query: string): InjectionCheckResult {
  const { matchedPatterns, riskLevel: patternRiskLevel } = matchInjectionPatterns(query);

  // Check for suspicious keyword density
  const suspiciousCount = countSuspiciousKeywords(query);

  const riskLevel = suspiciousCount >= 3 ? escalateToMedium(patternRiskLevel) : patternRiskLevel;

  const isDetected = matchedPatterns.length > 0 || suspiciousCount >= 3;

  // Sanitize the query by removing detected injection patterns if detected
  const sanitizedQuery = isDetected ? sanitizeQuery(query) : query;

  const reason = buildDetectionReason(isDetected, riskLevel);

  return {
    isDetected,
    riskLevel,
    matchedPatterns,
    sanitizedQuery,
    reason,
  };
}

/**
 * Logs injection attempts for monitoring
 * @param query - The original query
 * @param result - The injection check result
 * @param userId - The user ID (if available)
 */
export function logInjectionAttempt(
  query: string,
  result: InjectionCheckResult,
  userId?: string,
): void {
  if (result.isDetected) {
    logger.warn('[SECURITY] Prompt injection attempt detected', {
      userId,
      riskLevel: result.riskLevel,
      matchedPatterns: result.matchedPatterns,
      queryLength: query.length,
    });
  }
}
