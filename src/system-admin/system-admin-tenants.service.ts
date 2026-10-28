import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class SystemAdminTenantsService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
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
    const actorId = this.requireActorId(actor);
    const targetStatus = body.status as TenantStatus;
    const { updated } = await this.systemPrisma.$transaction(async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException(`Tenant ${id} not found`);
      }

      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: targetStatus,
          trialExpiresAt: body.trialExpiresAt
            ? new Date(body.trialExpiresAt)
            : undefined,
          gracePeriodEndsAt: body.gracePeriodEndsAt
            ? new Date(body.gracePeriodEndsAt)
            : undefined,
          suspendedAt: targetStatus === 'SUSPENDED' ? new Date() : undefined,
          sessionVersion: { increment: 1 },
        },
      });

      await tx.tenantLifecycleEvent.create({
        data: {
          tenantId: id,
          actorSystemAdminId: actorId,
          fromStatus: current.status,
          toStatus: updated.status,
          reason: body.reason ?? null,
          metadata: body,
        },
      });

      return { updated };
    });

    await this.cache.del(`tenant:state:${id}`);
    return { success: true, tenant: updated };
  }

  async extendTrial(id: string, days: number, actor: any) {
    const actorId = this.requireActorId(actor);
    const { updated } = await this.systemPrisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) {
        throw new NotFoundException(`Tenant ${id} not found`);
      }

      const base = tenant.trialExpiresAt ?? new Date();
      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: 'TRIAL',
          trialExpiresAt: new Date(
            base.getTime() + days * 24 * 60 * 60 * 1000,
          ),
          sessionVersion: { increment: 1 },
        },
      });

      await tx.tenantLifecycleEvent.create({
        data: {
          tenantId: id,
          actorSystemAdminId: actorId,
          fromStatus: tenant.status,
          toStatus: updated.status,
          metadata: { days },
        },
      });

      return { updated };
    });

    await this.cache.del(`tenant:state:${id}`);
    return { success: true, tenant: updated };
  }

  private requireActorId(actor: any): string {
    if (!actor?.id) {
      throw new UnauthorizedException('System admin identity is required');
    }
    return actor.id;
  }
}
