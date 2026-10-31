import { BadRequestException } from '@nestjs/common';
import { DocumentFormat, DocumentStatus } from '@prisma/client';
import { MAX_DOCUMENT_BYTES } from './limits';

export interface DocumentListQuery {
  search: string | null;
  category: string | null;
  status: DocumentStatus | null;
  page: number;
  pageSize: number;
}

export interface DocumentCreateInput {
  title: string;
  content: string;
  format: DocumentFormat;
  status: DocumentStatus;
  category: string | null;
}

export interface DocumentUpdateInput {
  title?: string;
  content?: string;
  format?: DocumentFormat;
  status?: DocumentStatus;
  category?: string | null;
}

const DOCUMENT_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const HTML_TAG = /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?\/?>/;
const BINARY_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function parseDocumentListQuery(
  raw: Record<string, unknown>,
): DocumentListQuery {
  const page = positiveInt(raw.page, 1, 'page');
  const pageSize = positiveInt(raw.pageSize, 25, 'pageSize');
  if (pageSize > 100) {
    throw invalid('pageSize must not exceed 100.');
  }

  const status = single(raw.status);
  if (status && !DOCUMENT_STATUSES.has(status)) {
    throw invalid('status must be DRAFT, PUBLISHED or ARCHIVED.');
  }

  const search = single(raw.search).trim();

  return {
    search: search ? search.slice(0, 200) : null,
    category: single(raw.category).trim() || null,
    status: (status as DocumentStatus) || null,
    page,
    pageSize,
  };
}

export function parseDocumentCreate(
  body: unknown,
  options: { defaultFormat: DocumentFormat; allowRichText: boolean },
): DocumentCreateInput {
  if (!isObject(body)) {
    throw invalid('Request body must be a JSON object.');
  }

  const title = requireString(body.title, 'title', 200);
  const content = requireContent(body.content);

  const format = parseFormat(body.format, options);
  validateContent(content, format);

  return {
    title,
    content: format === DocumentFormat.RICH_TEXT ? sanitizeRichText(content) : content,
    format,
    status: parseStatus(body.status, DocumentStatus.DRAFT),
    category: optionalString(body.category, 'category', 80),
  };
}

export function parseDocumentUpdate(
  body: unknown,
  options: { allowRichText: boolean },
): DocumentUpdateInput {
  if (!isObject(body)) {
    throw invalid('Request body must be a JSON object.');
  }

  const update: DocumentUpdateInput = {};

  if (body.title !== undefined) {
    update.title = requireString(body.title, 'title', 200);
  }

  if (body.format !== undefined) {
    update.format = parseFormat(body.format, {
      defaultFormat: DocumentFormat.MARKDOWN,
      allowRichText: options.allowRichText,
    });
  }

  if (body.content !== undefined) {
    const content = requireContent(body.content);
    const format = update.format ?? DocumentFormat.MARKDOWN;
    validateContent(content, format);
    update.content =
      format === DocumentFormat.RICH_TEXT ? sanitizeRichText(content) : content;
  }

  if (body.status !== undefined) {
    update.status = parseStatus(body.status, DocumentStatus.DRAFT);
  }

  if (body.category !== undefined) {
    update.category = optionalString(body.category, 'category', 80);
  }

  if (Object.keys(update).length === 0) {
    throw invalid('Provide at least one field to update.');
  }

  return update;
}

function parseFormat(
  value: unknown,
  options: { defaultFormat: DocumentFormat; allowRichText: boolean },
): DocumentFormat {
  if (value === undefined) return options.defaultFormat;

  if (value !== 'MARKDOWN' && value !== 'RICH_TEXT') {
    throw invalid('format must be MARKDOWN or RICH_TEXT.');
  }
  if (value === 'RICH_TEXT' && !options.allowRichText) {
    throw invalid('Rich text is disabled for this document hub.');
  }
  return value as DocumentFormat;
}

function parseStatus(
  value: unknown,
  fallback: DocumentStatus,
): DocumentStatus {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !DOCUMENT_STATUSES.has(value)) {
    throw invalid('status must be DRAFT, PUBLISHED or ARCHIVED.');
  }
  return value as DocumentStatus;
}

function requireContent(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid('content is required.');
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw invalid(
      `content must not exceed ${MAX_DOCUMENT_BYTES} bytes (200 KB).`,
    );
  }

  return value;
}

function validateContent(content: string, format: DocumentFormat): void {
  if (BINARY_CHARACTERS.test(content)) {
    throw invalid('content contains binary data.');
  }

  if (format === DocumentFormat.MARKDOWN && HTML_TAG.test(content)) {
    throw invalid(
      'Markdown documents must not contain raw HTML. Use RICH_TEXT for formatted content.',
    );
  }
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(`${name} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw invalid(`${name} must be at most ${max} characters.`);
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw invalid(`${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw invalid(`${name} must be at most ${max} characters.`);
  }
  return trimmed.length ? trimmed : null;
}

function positiveInt(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(single(value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw invalid(`${name} must be a positive integer.`);
  }
  return parsed;
}

function single(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  if (value === undefined || value === null) return '';
  return String(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Conservative rich-text sanitiser: strips executable tags, inline event
 * handlers and `javascript:` URLs. Full HTML is not rendered server-side.
 */
export function sanitizeRichText(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_DOCUMENT', message });
}
