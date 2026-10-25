import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { addHours } from 'date-fns';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantResolverService } from '../../tenant/tenant-resolver.service';
import { TenantStateService } from '../../tenant/tenant-state.service';
import { MailService } from '../../mail/mail.service';
import { SessionStateService } from './session-state.service';
import { PermissionResolutionService } from './permission-resolution.service';
import { FrontendAdapterService } from '../frontend-adapter.service';
import { CacheService } from '../../cache/cache.service';
import { blacklistKey } from '../blacklist-key';

export interface JwtAuthPayload {
  sub: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  roleId: string;
  roleSlug: string;
  roleName: string;
  roleRank: number;
  isTenantAdmin: boolean;
  dataScope: string;
  departmentId: string | null;
  departmentKey: string | null;
  managedDepartmentId: string | null;
  managedDepartmentKey: string | null;
  tenantStatus: string;
  sv: number;
  tsv: number;
  tv: number;
  aud: string;
  iss: string;
  scope?: string;
  jti?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly tenantResolver: TenantResolverService,
    private readonly tenantState: TenantStateService,
    private readonly permissionResolution: PermissionResolutionService,
    private readonly frontendAdapter: FrontendAdapterService,
    private readonly cache: CacheService,
    private readonly sessionState: SessionStateService,
  ) {}

  async login(
    email: string,
    password: string,
    tenantSlug: string,
  ): Promise<{ success: boolean; message: string; user: any; accessToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const workspace = await this.tenantResolver.resolveTenantBySlug(tenantSlug);

    if (!workspace) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.findUnique({
        where: {
          tenantId_email: {
            tenantId: workspace.id,
            email: normalizedEmail,
          },
        },
        include: {
          role: true,
          department: { select: { id: true, key: true } },
          managedDepartment: { select: { id: true, key: true } },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'SUSPENDED' || user.status === 'FIRED') {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const state = await this.tenantState.getState(workspace.id);

    await this.prisma.withTenant(workspace.id, async (tx: any) => {
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await tx.tenant.update({
        where: { id: workspace.id },
        data: { lastActivityAt: new Date() },
      });
    });

    const refreshedUser = (await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.findUnique({
        where: { id: user.id },
        include: {
          role: true,
          department: { select: { id: true, key: true } },
          managedDepartment: { select: { id: true, key: true } },
        },
      }),
    )) as any;

    const payload: JwtAuthPayload = {
      sub: refreshedUser.id,
      email: refreshedUser.email,
      tenantId: workspace.id,
      tenantSlug: workspace.slug,
      roleId: refreshedUser.roleId,
      roleSlug: refreshedUser.role.slug,
      roleName: refreshedUser.role.name,
      roleRank: refreshedUser.role.rank,
      isTenantAdmin: refreshedUser.role.isTenantAdmin,
      dataScope: refreshedUser.role.dataScope,
      departmentId: refreshedUser.departmentId,
      departmentKey: refreshedUser.department?.key ?? null,
      managedDepartmentId: refreshedUser.managedDepartment?.id ?? null,
      managedDepartmentKey: refreshedUser.managedDepartment?.key ?? null,
      tenantStatus: state.status,
      sv: refreshedUser.sessionVersion,
      tsv: state.sessionVersion,
      tv: 3,
      aud: 'tenant',
      iss: 'claspcrm',
    };

    const accessToken = this.jwtService.sign(payload);

    const access = await (this.frontendAdapter as any).getSessionAccess?.(refreshedUser) || {};
    const userPayload = {
      id: refreshedUser.id,
      email: refreshedUser.email,
      name: refreshedUser.name,
      isVerified: refreshedUser.isVerified,
      role: {
        id: refreshedUser.role.id,
        name: refreshedUser.role.name,
        slug: refreshedUser.role.slug,
        rank: refreshedUser.role.rank,
        isTenantAdmin: refreshedUser.role.isTenantAdmin,
        dataScope: refreshedUser.role.dataScope,
      },
      departmentId: refreshedUser.departmentId,
      department: refreshedUser.department
        ? { id: refreshedUser.department.id, key: refreshedUser.department.key }
        : null,
      managedDepartment: refreshedUser.managedDepartment
        ? {
            id: refreshedUser.managedDepartment.id,
            key: refreshedUser.managedDepartment.key,
          }
        : null,
      tenantId: workspace.id,
      tenantSlug: workspace.slug,
      tenantStatus: state.status,
      ...access,
    };

    return {
      success: true,
      message: 'Login successful',
      user: userPayload,
      accessToken,
    };
  }

  async verifyEmail(token: string, tenantSlug: string): Promise<any> {
    const workspace = await this.tenantResolver.resolveTenantBySlug(tenantSlug);
    if (!workspace) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tokenHash = hashToken(token);

    const user = await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.findFirst({
        where: {
          verifyTokenHash: tokenHash,
          verifyExpiresAt: { gt: new Date() },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verifyTokenHash: null,
          verifyExpiresAt: null,
        },
      }),
    );

    return { success: true, message: 'Email verified successfully!' };
  }

  async requestPasswordReset(
    email: string,
    tenantSlug: string,
  ): Promise<any> {
    const workspace = await this.tenantResolver.resolveTenantBySlug(tenantSlug);
    if (!workspace) {
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };
    }

    const user = await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.findFirst({ where: { email: email.trim().toLowerCase() } }),
    );
    if (!user) {
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenHash = hashToken(resetToken);

    await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          resetTokenHash,
          resetExpiresAt: addHours(new Date(), 1),
        },
      }),
    );

    await this.mailService.sendPasswordResetEmail(
      user.email,
      user.name,
      resetToken,
    );
    return { success: true, message: 'Password reset email sent' };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    tenantSlug: string,
  ): Promise<any> {
    const workspace = await this.tenantResolver.resolveTenantBySlug(tenantSlug);
    if (!workspace) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const tokenHash = hashToken(token);

    const user = await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.findFirst({
        where: {
          resetTokenHash: tokenHash,
          resetExpiresAt: { gt: new Date() },
        },
      }),
    );

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.withTenant(workspace.id, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetTokenHash: null,
          resetExpiresAt: null,
        },
      }),
    );

    return { success: true, message: 'Password reset successful' };
  }

  async refresh(user: any): Promise<any> {
    if (!user?.tenantId || !user?.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    const state = await this.tenantState.getState(user.tenantId);

    const sessionUser = await this.prisma.withTenant(user.tenantId, (tx) =>
      tx.user.findUnique({
        where: { id: user.sub },
        include: {
          role: true,
          department: { select: { id: true, key: true } },
          managedDepartment: { select: { id: true, key: true } },
        },
      }),
    );

    if (!sessionUser) {
      throw new UnauthorizedException('Invalid token');
    }

    if (sessionUser.status === 'SUSPENDED' || sessionUser.status === 'FIRED') {
      throw new UnauthorizedException('Invalid token');
    }

    const payload: JwtAuthPayload = {
      sub: sessionUser.id,
      email: sessionUser.email,
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      roleId: sessionUser.roleId,
      roleSlug: sessionUser.role.slug,
      roleName: sessionUser.role.name,
      roleRank: sessionUser.role.rank,
      isTenantAdmin: sessionUser.role.isTenantAdmin,
      dataScope: sessionUser.role.dataScope,
      departmentId: sessionUser.departmentId,
      departmentKey: sessionUser.department?.key ?? null,
      managedDepartmentId: sessionUser.managedDepartment?.id ?? null,
      managedDepartmentKey: sessionUser.managedDepartment?.key ?? null,
      tenantStatus: state.status,
      sv: sessionUser.sessionVersion,
      tsv: state.sessionVersion,
      tv: 3,
      aud: 'tenant',
      iss: 'claspcrm',
    };

    const accessToken = this.jwtService.sign(payload);
    const access = await (this.frontendAdapter as any).getSessionAccess?.(sessionUser) || {};

    return {
      success: true,
      accessToken,
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        role: {
          id: sessionUser.role.id,
          name: sessionUser.role.name,
          slug: sessionUser.role.slug,
          rank: sessionUser.role.rank,
          isTenantAdmin: sessionUser.role.isTenantAdmin,
          dataScope: sessionUser.role.dataScope,
        },
        departmentId: sessionUser.departmentId,
        department: sessionUser.department
          ? { id: sessionUser.department.id, key: sessionUser.department.key }
          : null,
        managedDepartment: sessionUser.managedDepartment
          ? {
              id: sessionUser.managedDepartment.id,
              key: sessionUser.managedDepartment.key,
            }
          : null,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        tenantStatus: state.status,
        ...access,
      },
    };
  }

  async logout(token: string | undefined): Promise<any> {
    if (token) {
      try {
        const payload = this.jwtService.decode(token) as any;
        if (payload?.exp) {
          const ttl = payload.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0 && payload?.tenantId) {
            await this.cache.set(
              this.cache.tenantKey(blacklistKey(token), payload.tenantId),
              true,
              ttl,
            );
          }
        }
      } catch {
        // ignore
      }
    }

    return { success: true, message: 'Logged out' };
  }

  async getAclModules(user: any): Promise<any> {
    return (this.frontendAdapter as any).getSessionAccess?.(user) || {};
  }

  async getAclPermissions(user: any): Promise<any> {
    const access = await (this.frontendAdapter as any).getSessionAccess?.(user) || {};
    return access?.permissions ?? {};
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  generateTokenFromPayload(payload: any): string {
    return this.jwtService.sign(payload);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
