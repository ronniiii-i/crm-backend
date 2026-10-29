import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { TenantProvisioningService } from '../tenant/tenant-provisioning.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SystemAdminTenantsService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly prisma: PrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly cache: CacheService,
  ) {}

  async list(query: any) {
    const where: Prisma.TenantWhereInput = {};
    const search = typeof query?.search === 'string' ? query.search.trim() : '';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { ownerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query?.status) {
      where.status = query.status as TenantStatus;
    }

    const tenants = await this.systemPrisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { success: true, tenants };
  }

  /**
   * Super-admin workspace creation. Runs the same provisioning pipeline as
   * self-serve onboarding so the new tenant gets its departments, roles,
   * modules, permission grants, and tenant-admin account in one transaction.
   */
  async create(body: CreateTenantDto, actor: any) {
    const actorId = this.requireActorId(actor);
    const slug = body.slug.trim().toLowerCase();
    const ownerEmail = body.ownerEmail.trim().toLowerCase();

    const existing = await this.systemPrisma.tenant.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException(`Workspace "${slug}" already exists`);
    }

    const tenantId = randomUUID();

    const { tenant, adminUserId, verificationToken } =
      await this.prisma.withTenant(tenantId, (tx) =>
        this.provisioning.provisionTenantData(tx, {
          tenantId,
          workspaceName: body.workspaceName,
          slug,
          ownerName: body.ownerName,
          ownerEmail,
          adminPassword: body.password,
        }),
      );

    if (body.trialDays) {
      await this.systemPrisma.tenant.update({
        where: { id: tenantId },
        data: {
          trialExpiresAt: new Date(Date.now() + body.trialDays * DAY_MS),
        },
      });
    }

    // If the super admin supplied a password the account is usable right away;
    // otherwise the owner completes the emailed verification flow.
    if (body.password) {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.user.update({
          where: { id: adminUserId },
          data: {
            isVerified: true,
            verifyTokenHash: null,
            verifyExpiresAt: null,
          },
        }),
      );
    }

    await this.systemPrisma.tenantLifecycleEvent.create({
      data: {
        tenantId,
        actorSystemAdminId: actorId,
        fromStatus: 'TRIAL',
        toStatus: 'TRIAL',
        reason: 'Workspace created by system administrator',
        metadata: {
          workspaceName: body.workspaceName,
          slug,
          trialDays: body.trialDays ?? null,
        },
      },
    });

    const created = await this.systemPrisma.tenant.findUnique({
      where: { id: tenantId },
    });

    return {
      success: true,
      tenant: created ?? tenant,
      // Surfaced only outside production so an operator can complete setup
      // when outbound email is not configured.
      verificationToken:
        process.env.NODE_ENV === 'development'
          ? body.password
            ? undefined
            : verificationToken
          : undefined,
    };
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
          trialExpiresAt: new Date(base.getTime() + days * 24 * 60 * 60 * 1000),
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
