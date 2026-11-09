import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { promises as fs } from 'node:fs';
import { Public } from '../auth/decorators/public.decorator';
import { User } from '../auth/decorators/user.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { StorageService } from './storage.service';
import { isAllowedMimeType } from './storage.types';

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('presign')
  @RateLimit({ policy: 'api-write', limit: 30, windowMs: 60 * 60 * 1000 })
  presign(
    @User() user: { sub: string; tenantId: string },
    @Body() dto: PresignUploadDto,
  ) {
    return this.storage.presignUpload({
      tenantId: user.tenantId,
      userId: user.sub,
      purpose: dto.purpose,
      contentType: dto.contentType,
      size: dto.size,
      entityType: dto.entityType,
      entityId: dto.entityId,
    });
  }

  /**
   * Local development upload target used by the signed presign URL.
   * The signed token carries the key, content type and maximum size, so the
   * endpoint stays public without allowing arbitrary writes.
   */
  @Public()
  @Put('local/upload')
  async upload(
    @Query('key') key: string,
    @Query('token') token: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const local = this.storage.local;
    if (!local) throw new NotFoundException();

    const payload = local.verifyUploadToken(token);
    if (payload.key !== key) {
      throw new BadRequestException('Upload token does not match the key');
    }

    const incoming = (contentType ?? payload.contentType)
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      incoming !== payload.contentType ||
      !isAllowedMimeType(
        payload.key.includes('/avatar/') ? 'avatar' : 'attachment',
        incoming,
      )
    ) {
      throw new BadRequestException('Content type does not match the upload');
    }

    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > payload.size) {
      throw new BadRequestException('Uploaded file is larger than declared');
    }

    await local.writeUpload(
      payload.key,
      payload.contentType,
      payload.size,
      request,
    );

    response.status(204).end();
  }

  /** Serve a local development object through its signed read URL. */
  @Public()
  @Get('local')
  async serve(
    @Query('key') key: string,
    @Query('sig') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    const local = this.storage.local;
    if (!local) throw new NotFoundException();

    const resolved = local.resolveRead(key, signature);
    let stat;
    try {
      stat = await fs.stat(resolved.absolutePath);
    } catch {
      throw new NotFoundException();
    }

    response.setHeader(
      'Content-Type',
      resolved.contentType ?? 'application/octet-stream',
    );
    response.setHeader('Content-Length', stat.size);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    local.createReadStream(resolved.absolutePath).pipe(response);
  }
}
