/**
 * @file fileValidator.ts
 * @description Server-side file security validation — magic bytes, size, filename sanitization
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import path from 'path';
import { FileValidationError, FileValidationErrorCode } from './errors.js';
import {
  type SupportedMimeType,
  type FileType,
  type FileValidationResult,
} from '../types/index.js';
import { logger } from './logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Magic byte signatures keyed by FileType.
 * null means no binary signature — encoding validation is used instead.
 */
const MAGIC_BYTES: Readonly<Record<FileType, ReadonlyArray<number> | null>> = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  docx: [0x50, 0x4b, 0x03, 0x04], // PK (ZIP — DOCX is a ZIP archive)
  txt: null,
  md: null,
};

/** File extensions that are inherently executable and signal a double-extension attack. */
const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.msi',
  '.dll',
  '.com',
  '.scr',
  '.vbs',
  '.js',
  '.jar',
]);

/** Map from safe file extension to FileType. */
const EXTENSION_TO_FILE_TYPE: Readonly<Record<string, FileType>> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
};

/**
 * Map from FileType to SupportedMimeType — the single source of truth for this
 * mapping. Other modules (upload routing, vector store row mapping) derive
 * their MIME↔FileType lookups from this map rather than maintaining their own
 * copies, so a new supported format only needs to be added here.
 */
export const FILE_TYPE_TO_MIME: Readonly<Record<FileType, SupportedMimeType>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
};

/** Inverse of FILE_TYPE_TO_MIME — derived, not hand-maintained, so it can't drift. */
export const MIME_TO_FILE_TYPE: Readonly<Record<string, FileType>> = Object.fromEntries(
  Object.entries(FILE_TYPE_TO_MIME).map(([fileType, mime]) => [mime, fileType as FileType]),
);

// ─── Zip Bomb Constants ───────────────────────────────────────────────────────

/**
 * Local file header signature in a ZIP archive (little-endian uint32 = PK\x03\x04).
 * DOCX files are ZIP archives — we parse headers to detect decompression bombs.
 */
const ZIP_LOCAL_FILE_SIG = 0x04034b50;

/** Maximum allowed ratio of uncompressed:compressed bytes per ZIP entry (100:1). */
const ZIP_BOMB_RATIO = 100;

/** Maximum total uncompressed bytes across all ZIP entries before rejection (500 MB). */
const ZIP_BOMB_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** Maximum number of ZIP entries to inspect (guards against crafted entry-count overflow). */
const ZIP_MAX_ENTRIES = 1_000;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Checks if a buffer starts with the given byte sequence at the specified offset.
 * @param buffer - File buffer to inspect
 * @param signature - Expected byte values (null = wildcard)
 * @param offset - Byte offset where the signature starts
 * @returns True if the buffer matches the signature
 */
function matchesMagicBytes(
  buffer: Buffer,
  signature: ReadonlyArray<number | null>,
  offset: number,
): boolean {
  if (buffer.length < offset + signature.length) return false;
  return signature.every((byte, i) => byte === null || buffer[offset + i] === byte);
}

/**
 * Checks whether a buffer contains valid UTF-8 encoded text.
 * Used for .txt and .md files that have no binary magic bytes.
 * @param buffer - Buffer to validate
 * @returns True if the buffer decodes as valid UTF-8
 */
function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects double-extension attacks such as `malware.pdf.exe`, where a
 * dangerous executable extension is hidden immediately before the final
 * extension. Only the final extension and the one immediately preceding it
 * are checked — a benign filename with an unrelated word in the middle
 * (e.g. "my.js.notes.txt") must not be rejected just because a dot-segment
 * elsewhere coincidentally matches a dangerous extension name.
 * @param filename - Filename to inspect (basename only, no path)
 * @returns True if the final or second-to-last extension segment is dangerous
 */
function hasDangerousExtension(filename: string): boolean {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;

  const finalExt = `.${parts[parts.length - 1]}`;
  if (DANGEROUS_EXTENSIONS.has(finalExt)) return true;

  if (parts.length < 3) return false;
  const precedingExt = `.${parts[parts.length - 2]}`;
  return DANGEROUS_EXTENSIONS.has(precedingExt);
}

/**
 * General-purpose bit flag bit 3: sizes are 0 in the local header and the
 * real compressed/uncompressed sizes only appear in a trailing data
 * descriptor after the entry's data. Common with streaming ZIP writers.
 */
const ZIP_GPBIT_DATA_DESCRIPTOR = 0x0008;

/**
 * Scans a ZIP buffer for decompression bomb signatures.
 *
 * Parses local file headers (PK\x03\x04) without decompressing any data.
 * Rejects if any single entry has an uncompressed:compressed ratio > ZIP_BOMB_RATIO,
 * if the total uncompressed size across all entries exceeds ZIP_BOMB_MAX_TOTAL_BYTES,
 * or if an entry uses a streaming data descriptor (bit 3) — its true compressed
 * size can't be read from the local header, so the scan can't safely continue
 * past it and the file is rejected rather than silently treated as safe.
 *
 * Threat: A04 Insecure Design — a crafted ZIP can decompress to gigabytes from
 * kilobytes, exhausting server RAM/disk and causing denial of service.
 *
 * @param buffer - Raw file buffer (must be a ZIP/DOCX file)
 * @returns True if a zip bomb pattern (or an unscannable entry) is detected
 */
function detectZipBomb(buffer: Buffer): boolean {
  let offset = 0;
  let totalUncompressed = 0;
  let entryCount = 0;

  while (offset + 30 <= buffer.length) {
    // Check for local file header signature
    const sig = buffer.readUInt32LE(offset);
    if (sig !== ZIP_LOCAL_FILE_SIG) break;

    const gpBitFlag = buffer.readUInt16LE(offset + 6);
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const filenameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);

    // Entries using a trailing data descriptor report size 0 in the local
    // header — the real compressed length isn't known without scanning
    // for the descriptor, so we can't safely skip past this entry's data.
    // Fail closed rather than risk desyncing the parse and silently
    // skipping a real bomb entry later in the archive.
    if ((gpBitFlag & ZIP_GPBIT_DATA_DESCRIPTOR) !== 0) return true;

    // Only check ratio for compressed entries (method != 0 means DEFLATE or similar).
    // Stored entries (method 0) have ratio 1:1 by definition.
    if (compressionMethod !== 0 && compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > ZIP_BOMB_RATIO) return true;
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > ZIP_BOMB_MAX_TOTAL_BYTES) return true;

    // Advance past this local file header + file data
    offset += 30 + filenameLen + extraLen + compressedSize;
    entryCount++;
    // Hitting the entry cap means there may still be unscanned entries
    // (potentially the bomb itself) past this point — fail closed, the
    // same as the unscannable-data-descriptor case above, rather than
    // reporting "safe" just because we stopped looking.
    if (entryCount >= ZIP_MAX_ENTRIES) return true;
  }

  return false;
}

/**
 * Detects filenames that appear to contain embedded script patterns.
 * Guards against filenames like `doc.pdf<script>alert(1)</script>.pdf` which
 * could be echoed into HTML or logs and execute in a browser context.
 *
 * Threat: A03 Injection — stored XSS via filename if the name is ever rendered in HTML.
 *
 * @param filename - Raw filename to inspect
 * @returns True if the filename contains script injection markers
 */
function hasEmbeddedScript(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes('<script') ||
    lower.includes('javascript:') ||
    lower.includes('data:text/html') ||
    lower.includes('vbscript:') ||
    lower.includes('onload=') ||
    lower.includes('onerror=')
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validates a file buffer by inspecting magic bytes for the given FileType.
 * For text types (txt, md) validates UTF-8 encoding instead.
 * @param buffer - Raw file buffer
 * @param fileType - Expected file type
 * @returns True if the buffer content matches the expected file type
 */
export async function validateMagicBytes(buffer: Buffer, fileType: FileType): Promise<boolean> {
  const signature = MAGIC_BYTES[fileType];

  if (signature === null) {
    return isValidUtf8(buffer);
  }

  return matchesMagicBytes(buffer, signature, 0);
}

/**
 * Validates that a file's size is within the allowed limit.
 * @param sizeBytes - File size in bytes
 * @param maxMB - Maximum allowed size in megabytes
 * @returns True if the file is within the size limit
 */
export function validateFileSize(sizeBytes: number, maxMB: number): boolean {
  return sizeBytes <= maxMB * 1024 * 1024;
}

/**
 * Validates a filename for path traversal attempts, null bytes,
 * double-extension attacks, and disallowed characters.
 * @param name - Filename to validate (should be basename only)
 * @returns True if the filename is safe
 */
export function validateFileName(name: string): boolean {
  if (!name || name.length > 255) return false;

  // Null byte injection
  if (name.includes('\0')) return false;

  // Path traversal: reject any path separators or parent directory components
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;

  // Double-extension attack (e.g. malware.pdf.exe — any segment is executable)
  if (hasDangerousExtension(name)) return false;

  // Allow only safe filename characters (alphanumeric, dots, hyphens, underscores, spaces, parens)
  return /^[\w.\-() ]+$/u.test(name);
}

/**
 * Sanitizes a filename by stripping path components and replacing
 * all characters outside the safe set with underscores.
 * @param name - Raw filename from user input
 * @returns Sanitized filename safe for storage
 */
export function sanitizeFileName(name: string): string {
  // Strip any path components, keep only the basename
  const base = path.basename(name);

  // Replace characters outside the safe set
  return base.replace(/[^\w.\-() ]/gu, '_');
}

/**
 * Runs the full server-side file validation pipeline:
 * size check → filename check → extension detection → magic bytes.
 * @param buffer - Raw file buffer from multer
 * @param originalName - Original filename provided by the client
 * @param maxMB - Maximum allowed file size in megabytes
 * @returns Validated file metadata
 * @throws {FileValidationError} On any validation failure
 */
// ─── Private sub-validators (extracted to keep validateFile complexity ≤ 10) ──

/**
 * Throws FileValidationError for filename security violations.
 * Checks size, script injection, path traversal, and character allowlist.
 * @param originalName - Raw filename from client
 */
function assertValidFilename(originalName: string): void {
  if (hasEmbeddedScript(originalName)) {
    throw new FileValidationError(
      'Filename contains embedded script markers',
      FileValidationErrorCode.EMBEDDED_SCRIPT,
    );
  }

  if (validateFileName(originalName)) return;

  // Determine whether it is a traversal or a general character issue
  const isTraversal =
    originalName.includes('..') || originalName.includes('/') || originalName.includes('\\');

  throw new FileValidationError(
    isTraversal ? 'Path traversal detected in filename' : `Invalid filename: "${originalName}"`,
    isTraversal ? FileValidationErrorCode.PATH_TRAVERSAL : FileValidationErrorCode.INVALID_FILENAME,
  );
}

/**
 * Resolves the FileType from the filename extension.
 * @param originalName - Validated filename
 * @returns FileType enum value
 * @throws {FileValidationError} If extension is not in the allowlist
 */
function resolveFileType(originalName: string): FileType {
  const ext = path.extname(originalName).toLowerCase();
  const fileType = EXTENSION_TO_FILE_TYPE[ext];
  if (fileType === undefined) {
    throw new FileValidationError(
      `Unsupported file extension "${ext}". Allowed: .pdf, .docx, .txt, .md`,
      FileValidationErrorCode.UNSUPPORTED_TYPE,
    );
  }
  return fileType;
}

/**
 * Verifies buffer content matches the declared file type and is not a zip bomb.
 * @param buffer - File buffer
 * @param fileType - Resolved file type
 * @param ext - File extension (for error message)
 * @throws {FileValidationError} If magic bytes don't match the declared type, or a zip bomb is detected
 */
async function assertSafeContent(buffer: Buffer, fileType: FileType, ext: string): Promise<void> {
  const magicOk = await validateMagicBytes(buffer, fileType);
  if (!magicOk) {
    throw new FileValidationError(
      `File content does not match the declared extension "${ext}"`,
      FileValidationErrorCode.INVALID_MAGIC_BYTES,
    );
  }
  // Zip bomb check — only for DOCX (ZIP-based format).
  if (fileType === 'docx' && detectZipBomb(buffer)) {
    throw new FileValidationError(
      'File rejected: suspicious compression ratio — possible zip bomb',
      FileValidationErrorCode.ZIP_BOMB,
    );
  }
}

/**
 * Runs the full server-side file validation pipeline:
 * size check → filename check → extension detection → magic bytes → zip bomb.
 * Complexity reduced to ≤ 5 by delegating each concern to a focused helper.
 * @param buffer - Raw file buffer from multer
 * @param originalName - Original filename provided by the client
 * @param maxMB - Maximum allowed file size in megabytes
 * @returns Validated file metadata
 * @throws {FileValidationError} On any validation failure
 */
export async function validateFile(
  buffer: Buffer,
  originalName: string,
  maxMB: number,
): Promise<FileValidationResult> {
  logger.debug('Validating file', { name: originalName, sizeBytes: buffer.length });

  if (!validateFileSize(buffer.length, maxMB)) {
    throw new FileValidationError(
      `File exceeds the maximum allowed size of ${maxMB} MB`,
      FileValidationErrorCode.FILE_TOO_LARGE,
      413,
    );
  }

  // Embedded script detection runs first to give the most specific error code.
  assertValidFilename(originalName);

  const fileType = resolveFileType(originalName);
  const ext = path.extname(originalName).toLowerCase();
  await assertSafeContent(buffer, fileType, ext);

  const sanitizedName = sanitizeFileName(originalName);
  const mimeType = FILE_TYPE_TO_MIME[fileType];

  logger.debug('File validated', { sanitizedName, fileType, sizeBytes: buffer.length });

  return { isValid: true, fileType, mimeType, sanitizedName, sizeBytes: buffer.length };
}
