import { Injectable, UnauthorizedException } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthPayload } from './auth.service';

@Injectable()
export class SessionStateService {
  private readonly cacheTtl = 60;

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  async assertFresh(payload: JwtAuthPayload): Promise<void> {
    if (payload.tv !== 3) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    const tenantId = payload.tenantId;
    const userId = payload.sub;

    if (!tenantId || !userId) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    const userKey = `session:user:${tenantId}:${userId}`;
    const tenantKey = `session:tenant:${tenantId}`;

    const cachedUser = await this.cache.get<number>(userKey);
    const cachedTenant = await this.cache.get<number>(tenantKey);

    if (
      cachedUser !== null &&
      cachedTenant !== null &&
      cachedUser === payload.sv &&
      cachedTenant === payload.tsv
    ) {
      return;
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { sessionVersion: true },
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { sessionVersion: true },
    });

    if (!user || !tenant) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    if (
      user.sessionVersion !== payload.sv ||
      tenant.sessionVersion !== payload.tsv
    ) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    await this.cache.set(userKey, user.sessionVersion, this.cacheTtl);
    await this.cache.set(tenantKey, tenant.sessionVersion, this.cacheTtl);
  }

  async flushUser(tenantId: string, userId: string): Promise<void> {
    await this.cache.del(`session:user:${tenantId}:${userId}`);
  }

  async flushTenant(tenantId: string): Promise<void> {
    await this.cache.del(`session:tenant:${tenantId}`);
  }
}
