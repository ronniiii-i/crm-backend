import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class SystemAdminTenantsService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(query: any) {
    const tenants = await this.systemPrisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { success: true, tenants };
  }

  async get(id: string) {
    const tenant = await this.systemPrisma.tenant.findUnique({
      where: { id },
    });
    const events = await this.systemPrisma.tenantLifecycleEvent.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { success: true, tenant, events };
  }

  async updateLifecycle(id: string, body: any, actor: any) {
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: body.status,
        trialExpiresAt: body.trialExpiresAt ? new Date(body.trialExpiresAt) : undefined,
        gracePeriodEndsAt: body.gracePeriodEndsAt ? new Date(body.gracePeriodEndsAt) : undefined,
        suspendedAt: body.status === 'SUSPENDED' ? new Date() : undefined,
        sessionVersion: { increment: 1 },
      },
    });

    await (this.systemPrisma.tenantLifecycleEvent.create as any)({
      data: {
        tenantId: id,
        actor: actor?.id,
        actorEmail: actor?.email,
        action: `SET_${body.status}`,
        reason: body.reason ?? null,
        metadata: body,
      },
    });

    await this.cache.del(`tenant:state:${id}`);
    return { success: true, tenant: updated };
  }

  async extendTrial(id: string, days: number, actor: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    const base = tenant?.trialExpiresAt ?? new Date();
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: 'TRIAL',
        trialExpiresAt: new Date(base.getTime() + days * 24 * 60 * 60 * 1000),
        sessionVersion: { increment: 1 },
      },
    });

    await (this.systemPrisma.tenantLifecycleEvent.create as any)({
      data: {
        tenantId: id,
        actor: actor?.id,
        actorEmail: actor?.email,
        action: 'EXTEND_TRIAL',
        metadata: { days },
      },
    });

    await this.cache.del(`tenant:state:${id}`);
    return { success: true, tenant: updated };
  }
}
