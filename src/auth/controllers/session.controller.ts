import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../decorators/user.decorator';
import { RateLimit } from '../../rate-limit/rate-limit.decorator';
import { UserSessionService } from '../services/user-session.service';

/**
 * Personal session management.
 *
 * Every route is scoped to the authenticated user. Tenant administrators do
 * not get cross-user access here; that would be a separate audited surface.
 */
@Controller('auth/sessions')
@UseGuards(JwtAuthGuard)
@RateLimit({ policy: 'auth-session' })
export class SessionController {
  constructor(private readonly sessions: UserSessionService) {}

  @Get()
  async list(@User() user: any) {
    const currentSessionId: string = user?.sid ?? '';
    const sessions = await this.sessions.list(
      user.tenantId,
      user.sub,
      currentSessionId || null,
    );
    return { sessions, currentSessionId: currentSessionId || null };
  }

  @Post('revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@User() user: any) {
    const revoked = await this.sessions.revokeOthers(
      user.tenantId,
      user.sub,
      user?.sid ?? null,
    );
    return { revoked };
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(@User() user: any) {
    const revoked = await this.sessions.revokeAll(user.tenantId, user.sub);
    return { revoked };
  }

  @Delete(':id')
  async revoke(
    @Param('id') id: string,
    @User() user: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.revokeSession(
      user.tenantId,
      user.sub,
      id,
      'USER_REVOKE',
    );

    if (user?.sid === id) {
      // Revoking the current session logs the client out; there is no body.
      response.status(HttpStatus.NO_CONTENT);
      return;
    }

    return { revoked: true };
  }
}
