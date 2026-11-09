import {
  BadRequestException,
  GoneException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  contentTypeForKey,
  type StorageDriver,
  type StorageHeadResult,
} from '../storage.types';

interface UploadTokenPayload {
  key: string;
  contentType: string;
  size: number;
  exp: number;
}

/**
 * Development storage: objects live under `crm-backend/uploads/` and are
 * uploaded/served through signed local endpoints. Never selected in
 * production (the storage factory and env validation both refuse it).
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;

  private readonly rootDir: string;
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    options: { rootDir?: string; baseUrl?: string; secret?: string } = {},
  ) {
    this.rootDir = options.rootDir ?? path.resolve(process.cwd(), 'uploads');
    this.baseUrl = (
      options.baseUrl ??
      process.env.STORAGE_LOCAL_BASE_URL ??
      `http://localhost:${process.env.PORT ?? 3030}`
    ).replace(/\/+$/, '');
    this.secret =
      options.secret ??
      process.env.JWT_SECRET ??
      'local-development-storage-secret';
  }

  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }): Promise<string> {
    const token = this.signUploadToken({
      key: input.key,
      contentType: input.contentType,
      size: input.size,
      exp: Date.now() + input.expiresInSeconds * 1000,
    });
    const query = new URLSearchParams({ key: input.key, token });
    return Promise.resolve(
      `${this.baseUrl}/storage/local/upload?${query.toString()}`,
    );
  }

  async head(key: string): Promise<StorageHeadResult | null> {
    try {
      const absolute = this.resolveObjectPath(key);
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) return null;
      return {
        contentLength: stat.size,
        contentType: contentTypeForKey(key),
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveObjectPath(key));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  publicUrl(key: string): string {
    const query = new URLSearchParams({
      key,
      sig: this.signRead(key),
    });
    return `${this.baseUrl}/storage/local?${query.toString()}`;
  }

  /** Validate the upload token before accepting bytes. */
  verifyUploadToken(token: string): UploadTokenPayload {
    const [encoded, signature] = (token ?? '').split('.');
    if (!encoded || !signature) {
      throw new BadRequestException('Invalid upload token');
    }
    const expected = createHmac('sha256', this.secret).update(encoded).digest();
    const provided = Buffer.from(signature, 'base64url');
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new BadRequestException('Invalid upload token');
    }

    let payload: UploadTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as UploadTokenPayload;
    } catch {
      throw new BadRequestException('Invalid upload token');
    }

    if (!payload?.key || !payload?.contentType || !payload?.size) {
      throw new BadRequestException('Invalid upload token');
    }
    if (payload.exp < Date.now()) {
      throw new GoneException('Upload token has expired');
    }
    return payload;
  }

  /**
   * Persist an uploaded body. The caller already validated that the request
   * content type matches the signed token; this re-checks the byte count so a
   * client cannot exceed the declared size.
   */
  async writeUpload(
    key: string,
    contentType: string,
    expectedSize: number,
    stream: AsyncIterable<Buffer | string>,
  ): Promise<{ size: number }> {
    const absolute = this.resolveObjectPath(key);
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > expectedSize) {
        throw new PayloadTooLargeException(
          'Uploaded file is larger than declared',
        );
      }
      chunks.push(buffer);
    }

    if (total === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }

    const body = Buffer.concat(chunks);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body);
    return { size: body.length };
  }

  /** Resolve a signed read request. */
  resolveRead(
    key: string,
    signature: string,
  ): { absolutePath: string; contentType?: string; size: number } {
    if (!signature || !this.isValidReadSignature(key, signature)) {
      throw new BadRequestException('Invalid file signature');
    }
    const absolutePath = this.resolveObjectPath(key);
    return { absolutePath, contentType: contentTypeForKey(key), size: 0 };
  }

  createReadStream(absolutePath: string) {
    return createReadStream(absolutePath);
  }

  private signUploadToken(payload: UploadTokenPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const signature = createHmac('sha256', this.secret)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${signature}`;
  }

  private signRead(key: string): string {
    return createHmac('sha256', this.secret)
      .update(`read:${key}`)
      .digest('base64url');
  }

  private isValidReadSignature(key: string, signature: string): boolean {
    const expected = Buffer.from(this.signRead(key));
    const provided = Buffer.from(signature);
    return (
      expected.length === provided.length && timingSafeEqual(expected, provided)
    );
  }

  private resolveObjectPath(key: string): string {
    // Reject traversal before touching the filesystem.
    if (
      !key ||
      key.startsWith('/') ||
      key.includes('..') ||
      key.includes('\\') ||
      !key.startsWith('tenants/')
    ) {
      throw new BadRequestException('Invalid object key');
    }
    const absolute = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);
    if (!absolute.startsWith(root + path.sep)) {
      throw new BadRequestException('Invalid object key');
    }
    return absolute;
  }
}
