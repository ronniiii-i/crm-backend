import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailLinkService } from '../email/email-link.service';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { addDays } from 'date-fns';
import { TenantResolverService } from '../tenant/tenant-resolver.service';
import { CacheService } from '../cache/cache.service';
import { NotificationsService } from '../notifications/notifications.service';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly emailLink: EmailLinkService,
    private readonly jwtService: JwtService,
    private readonly tenantResolver: TenantResolverService,
    private readonly cache: CacheService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async list(tenantId: string) {
    const invitations = await this.prisma.withTenant(tenantId, (tx) =>
      tx.invitation.findMany({
        where: { tenantId },
        include: {
          role: true,
          department: true,
          invitedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return { success: true, invitations };
  }

  async create(tenantId: string, inviter: any, dto: any) {
    const email = dto.email.trim().toLowerCase();

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = addDays(new Date(), 7);

    const { invitation, tenant, role } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const existingUser = await tx.user.findFirst({ where: { email } });
        if (existingUser)
          throw new ConflictException('User already exists in tenant');

        const role = await tx.role.findFirst({
          where: { id: dto.roleId, tenantId },
        });
        if (!role) throw new NotFoundException('Role not found');
        if (role.isTenantAdmin)
          throw new ForbiddenException('Cannot invite tenant admin');

        if (!inviter?.isTenantAdmin) {
          if (!inviter?.roleRank || role.rank > inviter.roleRank) {
            throw new ForbiddenException(
              'Cannot invite role higher than your own',
            );
          }
        }

        if (dto.departmentId) {
          if (!inviter?.isTenantAdmin) {
            const allowed =
              inviter.departmentId === dto.departmentId ||
              inviter.managedDepartmentId === dto.departmentId;
            if (!allowed)
              throw new ForbiddenException(
                'Cannot invite outside your department',
              );
          }
        }

        const workspace = await tx.tenant.findUnique({
          where: { id: tenantId },
        });
        if (!workspace) throw new NotFoundException('Tenant not found');
        if (workspace.status === 'SUSPENDED')
          throw new ForbiddenException('Tenant is suspended');

        // A re-invite supersedes any still-pending invitation for that email.
        await tx.invitation.updateMany({
          where: { tenantId, email, status: 'PENDING' },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });

        const created = await tx.invitation.create({
          data: {
            tenantId,
            email,
            tokenHash,
            roleId: role.id,
            departmentId: dto.departmentId || null,
            invitedByUserId: inviter.id,
            expiresAt,
          },
        });

        return { invitation: created, tenant: workspace, role };
      },
    );

    const result = await this.email.send('invitation', {
      to: email,
      inviteeEmail: email,
      inviterName: inviter?.name || 'A workspace administrator',
      workspaceName: tenant.name,
      roleName: role.name,
      acceptUrl: this.emailLink.build(tenant.slug, `invite/${token}`),
      expiresAt,
      tenantId,
      idempotencyKey: `invitation:${invitation.id}`,
    });
    if (!result.delivered) {
      this.logger.warn(
        JSON.stringify({
          event: 'invitation.email_failed',
          invitationId: invitation.id,
        }),
      );
    }

    return {
      success: true,
      invitation,
      token: process.env.NODE_ENV === 'development' ? token : undefined,
    };
  }

  async resend(tenantId: string, inviter: any, id: string) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = addDays(new Date(), 7);

    const { invitation, tenant } = await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const current = await tx.invitation.findFirst({
          where: { id, tenantId },
          include: { role: true },
        });
        if (!current) throw new NotFoundException('Invitation not found');
        if (current.status !== 'PENDING')
          throw new BadRequestException('Invitation not pending');

        await tx.invitation.update({
          where: { id },
          data: {
            tokenHash,
            expiresAt,
            lastSentAt: new Date(),
            sendCount: { increment: 1 },
          },
        });

        const workspace = await tx.tenant.findUnique({
          where: { id: tenantId },
        });
        if (!workspace) throw new NotFoundException('Tenant not found');

        return { invitation: current, tenant: workspace };
      },
    );

    const result = await this.email.send('invitation', {
      to: invitation.email,
      inviteeEmail: invitation.email,
      inviterName: inviter?.name || 'A workspace administrator',
      workspaceName: tenant.name,
      roleName: invitation.role?.name || 'member',
      acceptUrl: this.emailLink.build(tenant.slug, `invite/${token}`),
      expiresAt,
      tenantId,
      idempotencyKey: `invitation:${invitation.id}:${invitation.sendCount + 1}`,
    });
    if (!result.delivered) {
      this.logger.warn(
        JSON.stringify({
          event: 'invitation.email_failed',
          invitationId: invitation.id,
        }),
      );
    }

    return { success: true };
  }

  async revoke(tenantId: string, id: string) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.invitation.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
    );
    return { success: true };
  }

  async getPublic(token: string, tenantSlug: string) {
    const tenant = await this.tenantResolver.resolveTenantBySlug(tenantSlug);
    if (!tenant) throw new NotFoundException('Invalid invitation');
    const tokenHash = hashToken(token);

    const invitation = await this.prisma.withTenant(tenant.id, (tx) =>
      tx.invitation.findFirst({
        where: { tokenHash },
        include: {
          role: true,
          department: true,
          invitedBy: { select: { name: true, email: true } },
          tenant: true,
        },
      }),
    );

    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      invitation.expiresAt < new Date()
    ) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    return {
      success: true,
      invitation: {
        email: invitation.email,
        role: invitation.role,
        department: invitation.department,
        invitedBy: invitation.invitedBy,
        tenant: { name: invitation.tenant.name, slug: invitation.tenant.slug },
        expiresAt: invitation.expiresAt,
      },
    };
  }

  async accept(token: string, tenantSlug: string, dto: any) {
    const tenant = await this.tenantResolver.resolveTenantBySlug(tenantSlug);
    if (!tenant) throw new NotFoundException('Invalid invitation');
    if (tenant.status === 'SUSPENDED')
      throw new ForbiddenException('Tenant is suspended');

    const tokenHash = hashToken(token);
    const invitation = await this.prisma.withTenant(tenant.id, (tx) =>
      tx.invitation.findFirst({
        where: { tokenHash },
        include: { role: true, department: true },
      }),
    );

    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      invitation.expiresAt < new Date()
    ) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    const existing = await this.prisma.withTenant(tenant.id, (tx) =>
      tx.user.findFirst({ where: { email: invitation.email.toLowerCase() } }),
    );
    if (existing) throw new ConflictException('User already exists');

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.withTenant(tenant.id, async (tx: any) => {
      const created = await tx.user.create({
        data: {
          email: invitation.email.toLowerCase(),
          password: hashedPassword,
          name: dto.name,
          roleId: invitation.roleId,
          departmentId: invitation.departmentId,
          tenantId: tenant.id,
          isVerified: true,
          status: 'ACTIVE',
        },
        include: { role: true },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: 'ACCEPTED',
          acceptedByUserId: created.id,
          acceptedAt: new Date(),
        },
      });
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { seatCount: { increment: 1 }, lastActivityAt: new Date() },
      });
      return created;
    });

    await this.cache.invalidateUser(user.id, tenant.id);

    if (this.notifications && invitation.invitedByUserId) {
      await this.notifications.notify({
        tenantId: tenant.id,
        userId: invitation.invitedByUserId,
        type: 'SYSTEM',
        title: 'Invitation accepted',
        message: `${user.name} accepted your invitation and joined the workspace.`,
        link: '/user-management',
        dedupeKey: `INVITATION_ACCEPTED:${invitation.id}`,
        metadata: {
          invitationId: invitation.id,
          userId: user.id,
        },
      });
    }

    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      roleId: user.roleId,
      roleSlug: user.role.slug,
      roleName: user.role.name,
      roleRank: user.role.rank,
      isTenantAdmin: user.role.isTenantAdmin,
      dataScope: user.role.dataScope,
      departmentId: user.departmentId,
      tenantStatus: tenant.status,
      sv: 0,
      tsv: 0,
      tv: 3,
      aud: 'tenant',
      iss: 'claspworkspace',
    };

    const accessToken = this.jwtService.sign(payload);
    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
