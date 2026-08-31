/**
 * @file upload.schema.ts
 * @description Zod schemas for document upload — multi-file request validation
 * @author [Author Placeholder]
 * @created 2026-06-16
 */

import { z } from 'zod';
import { env } from '../config/env.js';

const MAX_FILE_SIZE = env.MAX_FILE_SIZE_MB * 1024 * 1024;

/** Supported MIME types accepted by the upload endpoint. */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** Schema for one multer File object in the req.files array. */
export const UploadFileSchema = z.object({
  originalname: z.string().max(255, 'Filename must be at most 255 characters'),
  mimetype: z.enum(SUPPORTED_MIME_TYPES, {
    errorMap: () => ({
      message: `Unsupported file type. Allowed: PDF, DOCX, TXT, MD, HTML`,
    }),
  }),
  size: z.number().max(MAX_FILE_SIZE, `File must not exceed ${MAX_FILE_SIZE / 1024 / 1024} MB`),
});

export type UploadFile = z.infer<typeof UploadFileSchema>;
