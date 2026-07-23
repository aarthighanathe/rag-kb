/**
 * @file estimateETA.ts
 * @description Estimates document processing time based on file size.
 *   Based on observed throughput: ~50KB/s for embedding pipeline
 *   including HuggingFace API latency.
 * @author [Author Placeholder]
 * @created 2026-07-01
 */

/**
 * Estimates processing time for a document given its file size.
 * Accounts for: text extraction, chunking, HuggingFace embedding
 * batches (32 chunks/batch, ~800ms/batch observed), Supabase write.
 * @param fileSizeBytes - File size in bytes
 * @param fileType - File type affects extraction complexity
 * @returns Estimated seconds remaining (minimum 5, maximum 120)
 */
export function estimateProcessingSeconds(
  fileSizeBytes: number,
  fileType: 'pdf' | 'docx' | 'txt' | 'md',
): number {
  const MULTIPLIERS: Record<string, number> = {
    pdf: 1.4,
    docx: 1.2,
    txt: 1.0,
    md: 1.0,
  };
  const multiplier = MULTIPLIERS[fileType] ?? 1.0;
  const estimated = (fileSizeBytes / 1024 / 50) * multiplier;
  return Math.max(5, Math.min(120, Math.round(estimated)));
}

/**
 * Formats seconds into a human-readable ETA string.
 * @param seconds - Remaining seconds
 * @returns e.g. "~45s", "~2m", "almost done"
 */
export function formatETA(seconds: number): string {
  if (seconds >= 60) return `~${Math.round(seconds / 60)}m`;
  if (seconds >= 10) return `~${Math.round(seconds)}s`;
  return 'almost done';
}
