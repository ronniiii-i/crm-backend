import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';

export type EffectiveTenantStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED';

export interface TenantState {
  id: string;
  slug: string;
  status: EffectiveTenantStatus;
  trialExpiresAt: Date | null;
  gracePeriodEndsAt: Date | null;
  suspendedAt: Date | null;
  sessionVersion: number;
  seatCount: number;
  ownerEmail: string | null;
  ownerName: string | null;
  billingEmail: string | null;
  lastActivityAt: Date | null;
}

const STATE_CACHE_TTL_MS = 30 * 1000;

@Injectable()
export class TenantStateService {
  private readonly cache = new Map<
    string,
    { value: TenantState; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async getState(tenantId: string): Promise<TenantState> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const cachedFromRedis = await this.cacheService.get<TenantState>(
      `tenant:state:${tenantId}`,
    );
    if (cachedFromRedis) {
      this.cache.set(tenantId, {
        value: cachedFromRedis,
        expiresAt: Date.now() + STATE_CACHE_TTL_MS,
      });
      return cachedFromRedis;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    let status = tenant.status as EffectiveTenantStatus;
    let trialExpiresAt = tenant.trialExpiresAt;
    let gracePeriodEndsAt = tenant.gracePeriodEndsAt;
    let suspendedAt = tenant.suspendedAt;
    let sessionVersion = tenant.sessionVersion;
    const now = new Date();

    if (status === 'TRIAL' && trialExpiresAt && trialExpiresAt < now) {
      const newGrace = new Date(
        now.getTime() +
          (Number.parseInt(process.env.WORKSPACE_GRACE_DAYS ?? '7', 10) || 7) *
            24 *
            60 *
            60 *
            1000,
      );

      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!current || current.status !== 'TRIAL') {
          return current;
        }
        if (!current.trialExpiresAt || current.trialExpiresAt >= now) {
          return current;
        }

        return tx.tenant.update({
          where: { id: tenantId },
          data: {
            status: 'PAST_DUE',
            gracePeriodEndsAt: newGrace,
            sessionVersion: current.sessionVersion + 1,
          },
        });
      });

      if (updated) {
        status = updated.status as EffectiveTenantStatus;
        gracePeriodEndsAt = updated.gracePeriodEndsAt;
        sessionVersion = updated.sessionVersion;
      }
    }

    if (status === 'PAST_DUE' && gracePeriodEndsAt && gracePeriodEndsAt < now) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const current = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!current || current.status !== 'PAST_DUE') {
          return current;
        }
        if (!current.gracePeriodEndsAt || current.gracePeriodEndsAt >= now) {
          return current;
        }

        return tx.tenant.update({
          where: { id: tenantId },
          data: {
            status: 'SUSPENDED',
            suspendedAt: now,
            sessionVersion: current.sessionVersion + 1,
          },
        });
      });

      if (updated) {
        status = updated.status as EffectiveTenantStatus;
        suspendedAt = updated.suspendedAt;
        sessionVersion = updated.sessionVersion;
      }
    }

    const state: TenantState = {
      id: tenant.id,
      slug: tenant.slug,
      status,
      trialExpiresAt,
      gracePeriodEndsAt,
      suspendedAt,
      sessionVersion,
      seatCount: tenant.seatCount,
      ownerEmail: tenant.ownerEmail,
      ownerName: tenant.ownerName,
      billingEmail: tenant.billingEmail,
      lastActivityAt: tenant.lastActivityAt,
    };

    this.cache.set(tenantId, {
      value: state,
      expiresAt: Date.now() + STATE_CACHE_TTL_MS,
    });
    await this.cacheService.set(`tenant:state:${tenantId}`, state, 30);

    return state;
  }

  flush(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  async flushAsync(tenantId: string): Promise<void> {
    this.cache.delete(tenantId);
    await this.cacheService.del(`tenant:state:${tenantId}`);
  }
}
