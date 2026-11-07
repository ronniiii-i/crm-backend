import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PermissionEffect, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { PermissionResolutionService } from '../auth/services/permission-resolution.service';

export type GrantSource = 'DIRECT' | 'INHERITED' | 'NONE';

export interface PermissionCell {
  moduleKey: string;
  action: string;
  granted: boolean;
  /** Where the effective value came from. */
  source: GrantSource;
  /** Explicit effect at the nearest role that defines this cell. */
  effect: PermissionEffect | null;
  inheritedFrom?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

@Injectable()
export class AccessControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  /** RLS requires `app.current_tenant` on the querying connection. */
  private scoped<T>(
    tenantId: string,
    fn: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(tenantId, fn);
  }

  async catalog(tenantId: string) {
    const modules = await this.scoped(tenantId, (tx) =>
      tx.module.findMany({
        where: { tenantId },
        orderBy: [{ group: 'asc' }, { order: 'asc' }, { name: 'asc' }],
      }),
    );

    const groupsMap = new Map<string, any[]>();
    for (const m of modules) {
      const list = groupsMap.get(m.group) || [];
      list.push({
        key: m.key,
        name: m.name,
        actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
      });
      groupsMap.set(m.group, list);
    }

    const groups = Array.from(groupsMap.entries()).map(([name, modules]) => ({
      name,
      modules,
    }));

    return {
      success: true,
      actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
      groups,
    };
  }

  async rolePermissions(tenantId: string, roleId: string) {
    const role = await this.scoped(tenantId, (tx) =>
      tx.role.findFirst({
        where: { id: roleId, tenantId },
        include: {
          parentRole: {
            select: { id: true, name: true, slug: true, rank: true },
          },
        },
      }),
    );
    if (!role) throw new BadRequestException('Role not found');

    const chain = await this.permissions.getRoleChain(roleId, tenantId);
    const chainIds = chain.map((entry) => entry.id);

    const data = await this.scoped(tenantId, async (tx) => {
      const modules = await tx.module.findMany({ where: { tenantId } });
      const perms = await tx.permission.findMany();
      const grants = await tx.roleModulePermission.findMany({
        where: {
          tenantId,
          roleId: { in: chainIds.length > 0 ? chainIds : [roleId] },
        },
      });
      return { modules, perms, grants };
    });

    // roleId -> `${moduleId}:${permissionId}` -> effect
    const byRole = new Map<string, Map<string, PermissionEffect>>();
    for (const grant of data.grants) {
      if (!byRole.has(grant.roleId)) byRole.set(grant.roleId, new Map());
      byRole
        .get(grant.roleId)!
        .set(
          `${grant.moduleId}:${grant.permissionId}`,
          grant.effect ?? PermissionEffect.GRANT,
        );
    }

    const ancestors = chain.filter((entry) => entry.id !== roleId);
    const direct = byRole.get(roleId) ?? new Map<string, PermissionEffect>();

    const result: PermissionCell[] = [];
    for (const m of data.modules) {
      for (const p of data.perms) {
        const key = `${m.id}:${p.id}`;

        if (role.isTenantAdmin) {
          result.push({
            moduleKey: m.key,
            action: p.type,
            granted: true,
            source: 'DIRECT',
            effect: PermissionEffect.GRANT,
            inheritedFrom: null,
          });
          continue;
        }

        const directEffect = direct.get(key);
        if (directEffect) {
          result.push({
            moduleKey: m.key,
            action: p.type,
            granted: directEffect === PermissionEffect.GRANT,
            source: 'DIRECT',
            effect: directEffect,
            inheritedFrom: null,
          });
          continue;
        }

        // Nearest ancestor wins: walk from the parent towards the root.
        let inheritedEffect: PermissionEffect | null = null;
        let inheritedFrom: PermissionCell['inheritedFrom'] = null;
        for (let index = ancestors.length - 1; index >= 0; index -= 1) {
          const ancestor = ancestors[index];
          const effect = byRole.get(ancestor.id)?.get(key);
          if (effect) {
            inheritedEffect = effect;
            inheritedFrom = {
              id: ancestor.id,
              name: ancestor.name,
              slug: ancestor.slug,
            };
            break;
          }
        }

        result.push({
          moduleKey: m.key,
          action: p.type,
          granted: inheritedEffect === PermissionEffect.GRANT,
          source: inheritedEffect ? 'INHERITED' : 'NONE',
          effect: inheritedEffect,
          inheritedFrom,
        });
      }
    }

    return {
      success: true,
      roleId,
      immutable: role.isTenantAdmin,
      role: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        parentRoleId: role.parentRoleId,
        parentRole: role.parentRole,
      },
      chain: chain.map((entry) => ({
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        rank: entry.rank,
      })),
      grants: result,
    };
  }

  async updateRolePermissions(
    tenantId: string,
    roleId: string,
    grants: any[],
    user?: any,
  ) {
    await this.scoped(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, tenantId },
      });
      if (!role) throw new BadRequestException('Role not found');
      if (role.isTenantAdmin)
        throw new ForbiddenException('Tenant admin permissions are immutable');

      const before = await tx.roleModulePermission.findMany({
        where: { tenantId, roleId },
        select: { moduleId: true, permissionId: true, effect: true },
      });

      const modules = await tx.module.findMany({ where: { tenantId } });
      const moduleByKey = new Map(
        modules.map((module) => [module.key, module]),
      );
      const perms = await tx.permission.findMany();
      const permissionByType = new Map(
        perms.map((permission) => [permission.type, permission]),
      );

      await tx.roleModulePermission.deleteMany({
        where: { tenantId, roleId },
      });

      const written: Array<{
        moduleId: string;
        permissionId: number;
        effect: PermissionEffect;
      }> = [];

      for (const grant of grants || []) {
        if (!grant || typeof grant !== 'object') continue;

        const effect =
          grant.effect === PermissionEffect.REVOKE || grant.effect === 'REVOKE'
            ? PermissionEffect.REVOKE
            : grant.effect === PermissionEffect.GRANT ||
                grant.effect === 'GRANT'
              ? PermissionEffect.GRANT
              : grant.granted === true
                ? PermissionEffect.GRANT
                : null;

        // No explicit effect and not granted: leave the cell inherited/empty.
        if (effect === null) continue;

        const module = moduleByKey.get(grant.moduleKey);
        const permission = permissionByType.get(grant.action);
        if (!module || !permission) continue;

        await tx.roleModulePermission.create({
          data: {
            tenantId,
            roleId,
            moduleId: module.id,
            permissionId: permission.id,
            effect,
          },
        });
        written.push({
          moduleId: module.id,
          permissionId: permission.id,
          effect,
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: user?.id ?? user?.sub ?? null,
          action: 'ROLE_PERMISSIONS_UPDATE',
          entity: 'role',
          entityId: roleId,
          before: before as unknown as Prisma.InputJsonValue,
          after: written as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.cache.invalidateTenantAcls(tenantId);
    return this.rolePermissions(tenantId, roleId);
  }
}
