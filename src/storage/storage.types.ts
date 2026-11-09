/**
 * Object storage contracts shared by the R2 and local development drivers.
 *
 * Keys are always opaque, tenant-scoped and derived on the server:
 * `tenants/<tenantId>/<purpose>/<userId>/<uuid>.<ext>`. The extension comes
 * from the content type rather than a user supplied filename so a caller
 * cannot smuggle an `.html` or `.svg` through the allowlist.
 */

export type StorageDriverName = 'local' | 'r2';

export type StoragePurpose = 'avatar' | 'attachment';

export interface PresignUploadInput {
  tenantId: string;
  userId: string;
  purpose: StoragePurpose;
  contentType: string;
  size: number;
  entityType?: string;
  entityId?: string;
}

export interface PresignUploadResult {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface StorageHeadResult {
  contentType?: string;
  contentLength?: number;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }): Promise<string>;
  head(key: string): Promise<StorageHeadResult | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

/** Images accepted for avatars. SVG is deliberately absent (stored XSS). */
export const AVATAR_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Attachments also include documents, spreadsheets and PDFs. */
export const ATTACHMENT_MIME_TYPES = [
  ...AVATAR_MIME_TYPES,
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export const EXTENSION_MIME_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, ext]) => [ext, mime]),
);

export function extensionForContentType(contentType: string): string | null {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[normalized] ?? null;
}

export function contentTypeForKey(key: string): string | undefined {
  const extension = key.split('.').pop()?.toLowerCase();
  return extension ? EXTENSION_MIME_TYPES[extension] : undefined;
}

export function isAvatarMimeType(contentType: string): boolean {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(
    contentType.split(';')[0].trim().toLowerCase(),
  );
}

export function isAllowedMimeType(
  purpose: StoragePurpose,
  contentType: string,
): boolean {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  const allowlist =
    purpose === 'avatar' ? AVATAR_MIME_TYPES : ATTACHMENT_MIME_TYPES;
  return (allowlist as readonly string[]).includes(normalized);
}
