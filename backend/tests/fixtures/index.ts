/**
 * @file index.ts
 * @description Programmatic test fixtures — all exported as Buffers so tests can
 *   pass them directly to supertest `.attach()` or the file-validator functions.
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Magic byte constants ──────────────────────────────────────────────────────

const PDF_MAGIC  = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK (ZIP)
const PNG_MAGIC  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ─── Minimal valid PDF ────────────────────────────────────────────────────────

/**
 * A syntactically valid minimal PDF-1.4 document (~400 bytes).
 * Passes magic-byte validation, but pdf-parse output depends on the mock.
 */
export const SAMPLE_PDF: Buffer = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
  'xref\n0 4\n' +
  '0000000000 65535 f \n' +
  '0000000009 00000 n \n' +
  '0000000058 00000 n \n' +
  '0000000115 00000 n \n' +
  'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
  'startxref\n204\n%%EOF',
);

// ─── Sample text fixture ──────────────────────────────────────────────────────

/**
 * 2 000-word plain-text document loaded from the static fixture file.
 * Falls back to a generated string when the file does not exist (CI environments).
 */
export const SAMPLE_TXT: Buffer = (() => {
  try {
    return readFileSync(resolve(__dirname, 'sample.txt'));
  } catch {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    return Buffer.from(words, 'utf-8');
  }
})();

// ─── Sample markdown fixture ──────────────────────────────────────────────────

/**
 * Markdown document with headings, lists, code blocks, and links.
 * Loaded from the static fixture file.
 */
export const SAMPLE_MD: Buffer = (() => {
  try {
    return readFileSync(resolve(__dirname, 'sample.md'));
  } catch {
    return Buffer.from(
      '# Sample Document\n\n## Section 1\n\nContent paragraph.\n\n- Item 1\n- Item 2\n\n```\ncode block\n```\n',
      'utf-8',
    );
  }
})();

// ─── Minimal DOCX (ZIP container) ────────────────────────────────────────────

/**
 * Minimal DOCX buffer — starts with ZIP magic bytes (PK\x03\x04) so it passes
 * magic-byte validation. NOT a parseable archive; mammoth is mocked in tests.
 */
export const SAMPLE_DOCX: Buffer = Buffer.concat([
  DOCX_MAGIC,
  Buffer.from('\x14\x00\x00\x00\x08\x00', 'binary'), // version + flags + compression
  Buffer.alloc(50, 0),                                  // padding
]);

// ─── Path traversal filename fixture ─────────────────────────────────────────

/**
 * Valid PDF content intended to be uploaded with a path-traversal filename
 * such as `../../etc/passwd.pdf`. The buffer itself is a valid PDF; the
 * filename attack lives in the original-name string, tested separately.
 */
export const MALICIOUS_PATH_PDF: Buffer = Buffer.concat([
  PDF_MAGIC,
  Buffer.from('-1.0\nMalicious path traversal attempt'),
]);

/** Suggested attack filename for use with MALICIOUS_PATH_PDF. */
export const MALICIOUS_PATH_FILENAME = '../../etc/passwd.pdf';

// ─── Oversized PDF fixture ────────────────────────────────────────────────────

/**
 * PDF buffer that exceeds the 10 MB size limit (10 MB + 1 byte).
 * Starts with valid PDF magic bytes so size is the only failure trigger.
 */
export const TOO_LARGE_PDF: Buffer = (() => {
  const target = 10 * 1024 * 1024 + 1; // just over 10 MB
  const buf = Buffer.alloc(target, 0x20); // fill with spaces
  PDF_MAGIC.copy(buf, 0);
  return buf;
})();

// ─── Fake PDF (wrong magic bytes) ────────────────────────────────────────────

/**
 * A buffer with a `.pdf` extension but PNG magic bytes at offset 0.
 * Used to test magic-byte mismatch detection — should throw INVALID_MAGIC_BYTES.
 */
export const FAKE_PDF: Buffer = Buffer.concat([
  PNG_MAGIC,
  Buffer.from(' This is not a PDF — it has PNG magic bytes.'),
]);

// ─── Helper: make a buffer with specific magic bytes ──────────────────────────

/**
 * Creates a buffer padded to `totalLen` with the given magic bytes at offset 0.
 * @param magic    - Magic byte sequence
 * @param totalLen - Total buffer length (default 64)
 * @returns Padded buffer
 */
export function makeMagicBuffer(magic: number[], totalLen = 64): Buffer {
  const buf = Buffer.alloc(totalLen, 0);
  magic.forEach((b, i) => { buf[i] = b; });
  return buf;
}
