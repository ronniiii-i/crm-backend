import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { R2StorageDriver } from './drivers/r2-storage.driver';
import {
  extensionForContentType,
  isAllowedMimeType,
  isAvatarMimeType,
  type PresignUploadInput,
  type PresignUploadResult,
  type StorageDriver,
  type StorageHeadResult,
  type StoragePurpose,
} from './storage.types';

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

const PRESIGN_TTL_SECONDS = 5 * 60;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when STORAGE_DRIVER=r2`);
  }
  return value;
}

/** Build the configured driver. Called once by the Nest module factory. */
export function createStorageDriver(): StorageDriver {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').trim().toLowerCase();

  if (driver === 'r2') {
    return new R2StorageDriver({
      accountId: required('R2_ACCOUNT_ID'),
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: required('R2_BUCKET'),
      publicBaseUrl: required('R2_PUBLIC_BASE_URL'),
      endpoint: process.env.R2_ENDPOINT,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'STORAGE_DRIVER=local is not permitted in production; configure R2',
    );
  }

  return new LocalStorageDriver();
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {}

  get driverName(): StorageDriver['name'] {
    return this.driver.name;
  }

  get isLocal(): boolean {
    return this.driver.name === 'local';
  }

  get local(): LocalStorageDriver | null {
    return this.driver instanceof LocalStorageDriver ? this.driver : null;
  }

  get maxAvatarBytes(): number {
    return Number(process.env.STORAGE_MAX_AVATAR_BYTES ?? 5_242_880);
  }

  get maxAttachmentBytes(): number {
    return Number(process.env.STORAGE_MAX_ATTACHMENT_BYTES ?? 26_214_400);
  }

  get attachmentsEnabled(): boolean {
    return (process.env.ATTACHMENTS_ENABLED ?? 'true').trim() !== 'false';
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const contentType = input.contentType?.split(';')[0].trim().toLowerCase();
    if (!isAllowedMimeType(input.purpose, contentType)) {
      throw new BadRequestException(
        `Unsupported file type for ${input.purpose}`,
      );
    }

    const maxBytes = this.maxBytesFor(input.purpose);
    if (!Number.isFinite(input.size) || input.size <= 0) {
      throw new BadRequestException('File size must be greater than zero');
    }
    if (input.size > maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
      );
    }

    const extension = extensionForContentType(contentType);
    if (!extension) {
      throw new BadRequestException('Unsupported file type');
    }

    const key = `tenants/${input.tenantId}/${input.purpose}/${input.userId}/${randomUUID()}.${extension}`;
    const uploadUrl = await this.driver.presignUpload({
      key,
      contentType,
      size: input.size,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });

    return {
      uploadUrl,
      key,
      publicUrl: this.driver.publicUrl(key),
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(
        Date.now() + PRESIGN_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  head(key: string): Promise<StorageHeadResult | null> {
    return this.driver.head(key);
  }

  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }

  publicUrl(key: string): string {
    return this.driver.publicUrl(key);
  }

  /** Short-lived download URL (local HMAC read URL or R2 signed GET). */
  signedReadUrl(key: string): Promise<string> {
    return this.driver.signedReadUrl(key);
  }

  /** Reject a finalize request for a key owned by another user or tenant. */
  assertAvatarKey(tenantId: string, userId: string, key: string): void {
    const prefix = `tenants/${tenantId}/avatar/${userId}/`;
    if (!key || !key.startsWith(prefix) || key.includes('..')) {
      throw new BadRequestException('Avatar key does not belong to this user');
    }
  }

  /** Validate an uploaded avatar after HEAD-ing the object. */
  assertAvatarObject(
    head: StorageHeadResult | null,
  ): asserts head is StorageHeadResult {
    if (!head) {
      throw new BadRequestException('Uploaded avatar was not found');
    }
    if (head.contentType && !isAvatarMimeType(head.contentType)) {
      throw new BadRequestException('Uploaded file is not a supported image');
    }
    if (
      typeof head.contentLength === 'number' &&
      head.contentLength > this.maxAvatarBytes
    ) {
      throw new BadRequestException('Uploaded avatar is too large');
    }
  }

  /** Reject a finalize request for an attachment key owned by another user. */
  assertAttachmentKey(tenantId: string, userId: string, key: string): void {
    const prefix = `tenants/${tenantId}/attachment/${userId}/`;
    if (!key || !key.startsWith(prefix) || key.includes('..')) {
      throw new BadRequestException(
        'Attachment key does not belong to this user',
      );
    }
  }

  /** Validate an uploaded attachment after HEAD-ing the object. */
  assertAttachmentObject(
    head: StorageHeadResult | null,
  ): asserts head is StorageHeadResult {
    if (!head) {
      throw new BadRequestException('Uploaded attachment was not found');
    }
    if (
      head.contentType &&
      !isAllowedMimeType('attachment', head.contentType)
    ) {
      throw new BadRequestException(
        'Uploaded file is not a supported attachment type',
      );
    }
    if (
      typeof head.contentLength === 'number' &&
      head.contentLength > this.maxAttachmentBytes
    ) {
      throw new BadRequestException('Uploaded attachment is too large');
    }
  }

  /** Best-effort cleanup when a user removes their avatar. */
  async deleteByPublicUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;
    try {
      let key: string | null = null;
      if (this.driver.name === 'local') {
        key = new URL(url).searchParams.get('key');
      } else {
        const base = (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
        if (base && url.startsWith(`${base}/`)) {
          key = url.slice(base.length + 1);
        }
      }
      if (key) await this.driver.delete(key);
    } catch (error) {
      this.logger.warn(
        `Avatar object cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private maxBytesFor(purpose: StoragePurpose): number {
    return purpose === 'avatar' ? this.maxAvatarBytes : this.maxAttachmentBytes;
  }
}
