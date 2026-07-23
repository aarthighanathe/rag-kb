/**
 * @file fileValidator.test.ts
 * @description Unit tests for file security validation — magic bytes, size, filename, sanitization,
 *              zip bomb detection, null byte injection, embedded script detection
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { describe, it, expect } from 'vitest';
import {
  validateMagicBytes,
  validateFileSize,
  validateFileName,
  sanitizeFileName,
  validateFile,
} from '../../src/utils/fileValidator';
import { FileValidationError, FileValidationErrorCode } from '../../src/utils/errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuf(magic: number[], totalLen = 16): Buffer {
  const buf = Buffer.alloc(totalLen);
  magic.forEach((b, i) => { buf[i] = b; });
  return buf;
}

const PDF_MAGIC  = [0x25, 0x50, 0x44, 0x46];
const DOCX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// ─── validateMagicBytes ───────────────────────────────────────────────────────

describe('validateMagicBytes', () => {
  it('returns true for a valid PDF buffer', async () => {
    expect(await validateMagicBytes(makeBuf(PDF_MAGIC), 'pdf')).toBe(true);
  });

  it('returns true for a valid DOCX buffer', async () => {
    expect(await validateMagicBytes(makeBuf(DOCX_MAGIC), 'docx')).toBe(true);
  });

  it('returns false when PDF magic bytes are wrong', async () => {
    expect(await validateMagicBytes(makeBuf([0x00, 0x01, 0x02, 0x03]), 'pdf')).toBe(false);
  });

  it('returns true for a UTF-8 text buffer as txt type', async () => {
    expect(await validateMagicBytes(Buffer.from('Hello world'), 'txt')).toBe(true);
  });

  it('returns true for a valid markdown buffer as md type', async () => {
    expect(await validateMagicBytes(Buffer.from('# Heading'), 'md')).toBe(true);
  });
});

// ─── validateFileSize ─────────────────────────────────────────────────────────

describe('validateFileSize', () => {
  it('returns true when file is within the limit', () => {
    expect(validateFileSize(5 * 1024 * 1024, 10)).toBe(true);  // 5 MB < 10 MB
  });

  it('returns true when file is exactly at the limit', () => {
    expect(validateFileSize(10 * 1024 * 1024, 10)).toBe(true); // exactly 10 MB
  });

  it('returns false when file exceeds the limit', () => {
    expect(validateFileSize(11 * 1024 * 1024, 10)).toBe(false); // 11 MB > 10 MB
  });
});

// ─── validateFileName ─────────────────────────────────────────────────────────

describe('validateFileName', () => {
  it('accepts a normal filename', () => {
    expect(validateFileName('document.pdf')).toBe(true);
    expect(validateFileName('My Report 2026.docx')).toBe(true);
  });

  it('rejects path traversal sequences', () => {
    expect(validateFileName('../../etc/passwd')).toBe(false);
    expect(validateFileName('../secret.pdf')).toBe(false);
  });

  it('rejects filenames containing forward slash', () => {
    expect(validateFileName('folder/file.pdf')).toBe(false);
  });

  it('rejects filenames containing backslash', () => {
    expect(validateFileName('folder\\file.pdf')).toBe(false);
  });

  it('rejects double-extension attacks', () => {
    expect(validateFileName('malware.pdf.exe')).toBe(false);
    expect(validateFileName('virus.docx.bat')).toBe(false);
  });

  it('rejects empty and overly long filenames', () => {
    expect(validateFileName('')).toBe(false);
    expect(validateFileName('a'.repeat(256) + '.pdf')).toBe(false);
  });
});

// ─── sanitizeFileName ─────────────────────────────────────────────────────────

describe('sanitizeFileName', () => {
  it('strips path components and returns only the basename', () => {
    const result = sanitizeFileName('../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('replaces dangerous characters with underscores', () => {
    const result = sanitizeFileName('report <2026>.pdf');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).toContain('_');
  });

  it('preserves safe characters — letters, digits, dots, hyphens', () => {
    const result = sanitizeFileName('my-report_2026.pdf');
    expect(result).toBe('my-report_2026.pdf');
  });

  it('handles Windows-style absolute paths', () => {
    const result = sanitizeFileName('C:\\Users\\admin\\secret.txt');
    expect(result).not.toContain('C:');
    expect(result).not.toContain('\\');
  });
});

// ─── validateFileName (additional security cases) ─────────────────────────────

describe('validateFileName — security edge cases', () => {
  it('rejects filenames with null byte injection', () => {
    // Null bytes truncate strings in C-backed filesystems, hiding the real extension.
    expect(validateFileName('file\x00.pdf')).toBe(false);
    expect(validateFileName('\x00secret')).toBe(false);
  });

  it('rejects filenames with embedded script tags', () => {
    // Filenames echoed into HTML without escaping can execute in the browser.
    expect(validateFileName('<script>alert(1)</script>.pdf')).toBe(false);
    expect(validateFileName('file onload=alert(1).pdf')).toBe(false);
  });

  it('rejects double-extension attacks with all dangerous extensions', () => {
    expect(validateFileName('malware.pdf.exe')).toBe(false);
    expect(validateFileName('virus.docx.bat')).toBe(false);
    expect(validateFileName('trojan.txt.ps1')).toBe(false);
    expect(validateFileName('worm.md.vbs')).toBe(false);
  });
});

// ─── validateFile (full pipeline) ─────────────────────────────────────────────

describe('validateFile', () => {
  it('accepts a valid PDF and returns correct metadata', async () => {
    const buf = makeBuf(PDF_MAGIC, 1024);
    const result = await validateFile(buf, 'report.pdf', 10);
    expect(result.isValid).toBe(true);
    expect(result.fileType).toBe('pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.sizeBytes).toBe(1024);
    expect(result.sanitizedName).toBe('report.pdf');
  });

  it('accepts a valid DOCX buffer', async () => {
    const buf = makeBuf(DOCX_MAGIC, 2048);
    const result = await validateFile(buf, 'resume.docx', 10);
    expect(result.fileType).toBe('docx');
  });

  it('throws FileValidationError when the file is too large', async () => {
    const buf = makeBuf(PDF_MAGIC, 11 * 1024 * 1024);
    await expect(validateFile(buf, 'big.pdf', 10)).rejects.toBeInstanceOf(FileValidationError);
  });

  it('throws FILE_TOO_LARGE error code for oversized files', async () => {
    const buf = makeBuf(PDF_MAGIC, 11 * 1024 * 1024);
    const err = await validateFile(buf, 'big.pdf', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.FILE_TOO_LARGE);
  });

  it('throws FileValidationError for path traversal filenames', async () => {
    const buf = makeBuf(PDF_MAGIC, 512);
    await expect(validateFile(buf, '../../etc/passwd', 10)).rejects.toBeInstanceOf(FileValidationError);
  });

  it('throws PATH_TRAVERSAL error code for ../../etc/passwd pattern', async () => {
    const buf = makeBuf(PDF_MAGIC, 512);
    const err = await validateFile(buf, '../../etc/passwd', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.PATH_TRAVERSAL);
  });

  it('throws FileValidationError for unsupported file extension', async () => {
    const buf = Buffer.from('\x89PNG\r\n');
    await expect(validateFile(buf, 'image.png', 10)).rejects.toBeInstanceOf(FileValidationError);
  });

  it('throws FileValidationError for null byte injection in filename', async () => {
    const buf = makeBuf(PDF_MAGIC, 512);
    // Null byte hides ".exe" from naive extension checks: file.pdf\x00.exe
    await expect(validateFile(buf, 'file\x00.pdf', 10)).rejects.toBeInstanceOf(FileValidationError);
  });

  it('throws EMBEDDED_SCRIPT error code for script tags in filename', async () => {
    const buf = makeBuf(PDF_MAGIC, 512);
    const err = await validateFile(buf, '<script>xss</script>.pdf', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.EMBEDDED_SCRIPT);
  });

  it('throws FileValidationError for double-extension attack (malware.pdf.exe)', async () => {
    const buf = makeBuf(PDF_MAGIC, 512);
    await expect(validateFile(buf, 'malware.pdf.exe', 10)).rejects.toBeInstanceOf(FileValidationError);
  });
});

// ─── Zip bomb detection ────────────────────────────────────────────────────────

describe('validateFile — zip bomb detection', () => {
  /**
   * Builds a minimal synthetic ZIP local file header.
   * The ZIP_LOCAL_FILE_SIG (PK\x03\x04) doubles as the DOCX magic bytes,
   * so this buffer passes magic-byte validation and then triggers zip bomb checks.
   */
  function makeZipHeader({
    compressionMethod = 8,   // DEFLATE
    compressedSize = 1,
    uncompressedSize = 200 * 1024 * 1024,  // 200 MB — ratio 200 000 000:1 > 100:1
  }: {
    compressionMethod?: number;
    compressedSize?: number;
    uncompressedSize?: number;
  } = {}): Buffer {
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(0x04034b50, 0);    // PK\x03\x04 — local file header sig (= DOCX magic)
    buf.writeUInt16LE(20, 4);            // version needed
    buf.writeUInt16LE(0, 6);             // general purpose flags
    buf.writeUInt16LE(compressionMethod, 8);
    buf.writeUInt16LE(0, 10);            // last mod time
    buf.writeUInt16LE(0, 12);            // last mod date
    buf.writeUInt32LE(0, 14);            // CRC-32
    buf.writeUInt32LE(compressedSize, 18);
    buf.writeUInt32LE(uncompressedSize, 22);
    buf.writeUInt16LE(1, 26);            // filename length = 1
    buf.writeUInt16LE(0, 28);            // extra field length = 0
    buf.writeUInt8(0x61, 30);            // filename = 'a'
    buf.writeUInt8(0xff, 31);            // compressed data (1 byte placeholder)
    return buf;
  }

  it('rejects a DOCX with suspicious compression ratio (> 100:1)', async () => {
    // compressed=1 byte, uncompressed=200 MB → ratio 200_000_000 > 100
    const buf = makeZipHeader({ compressedSize: 1, uncompressedSize: 200 * 1024 * 1024 });
    const err = await validateFile(buf, 'bomb.docx', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.ZIP_BOMB);
  });

  it('rejects a DOCX whose total uncompressed size exceeds 500 MB', async () => {
    // Two entries each claiming 300 MB uncompressed — total 600 MB > limit
    const entry = makeZipHeader({ compressedSize: 10, uncompressedSize: 300 * 1024 * 1024 });
    // Concatenate two copies to simulate two archive entries totalling 600 MB claimed
    const buf = Buffer.concat([entry, entry]);
    const err = await validateFile(buf, 'total-bomb.docx', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.ZIP_BOMB);
  });

  it('accepts a legitimate DOCX with safe compression ratio', async () => {
    // compressed=1000 bytes, uncompressed=10 000 bytes → ratio 10:1 (well under 100:1)
    const buf = makeZipHeader({ compressedSize: 1_000, uncompressedSize: 10_000 });
    const result = await validateFile(buf, 'safe.docx', 10);
    expect(result.isValid).toBe(true);
    expect(result.fileType).toBe('docx');
  });

  it('accepts a DOCX stored uncompressed (method 0, ratio 1:1)', async () => {
    // Stored entries always have ratio 1:1 — should never be flagged as bombs
    const buf = makeZipHeader({ compressionMethod: 0, compressedSize: 5_000, uncompressedSize: 5_000 });
    const result = await validateFile(buf, 'stored.docx', 10);
    expect(result.isValid).toBe(true);
  });

  // Regression: hitting the 1,000-entry scan cap used to `break` out of the
  // loop and fall through to `return false` ("safe"), silently trusting any
  // entry past the cap — including a bomb entry placed at #1,001+.
  it('rejects (fails closed) a DOCX with more entries than the scan cap', async () => {
    // Each entry: 30-byte header + 1-byte filename + 1-byte compressed data,
    // with compressedSize/extraLen set so the scanner's offset advance
    // (30 + filenameLen + extraLen + compressedSize) lands exactly on the
    // next entry's header — keeping every entry aligned and parseable.
    const buf = makeZipHeader({ compressionMethod: 0, compressedSize: 1, uncompressedSize: 1 }).subarray(0, 32);
    // 1,001 safe, compliant, correctly-aligned entries — one past
    // ZIP_MAX_ENTRIES (1,000) — so the scanner must stop mid-archive without
    // having verified every entry.
    const entries = Array.from({ length: 1_001 }, () => buf);
    const fullBuf = Buffer.concat(entries);
    const err = await validateFile(fullBuf, 'many-entries.docx', 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileValidationError);
    expect((err as FileValidationError).code).toBe(FileValidationErrorCode.ZIP_BOMB);
  });
});
