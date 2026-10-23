import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { getTenantId } from '../../tenant/tenant-context';
import { PermissionType, PermissionEffect } from '@prisma/client';
import { UserForAcl } from '../permission-types';

/** Where a permission came from. Used by the UI to render `Role+` badges. */
export type PermissionSourceType = 'ROLE' | 'GROUP' | 'OVERRIDE';

export interface PermissionSource {
  type: PermissionSourceType;
  effect?: PermissionEffect;
  groupId?: string;
  groupName?: string;
}

export interface EffectivePermission {
  moduleId: string;
  permissionType: PermissionType;
  granted: boolean;
  sources: PermissionSource[];
}

/**
 * Resolves the effective permission set for a user using the hybrid ACL model:
 *
 *   1. Base role permissions (RoleModulePermission)
 *   2. Permission groups assigned directly to the user or to their department
 *   3. Per-user overrides (GRANT/REVOKE) — highest precedence
 *
 * All lookups run inside a tenant transaction so Postgres RLS applies.
 */
@Injectable()
export class PermissionResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private cacheKey(userId: string, tenantId?: string): string {
    return this.cache.tenantKey(
      `user:${userId}:effective-permissions`,
      tenantId,
    );
  }

  /**
   * Effective permissions grouped by module id.
   * The returned map only contains modules the user can actually act on.
   */
  async getEffectivePermissions(
    user: UserForAcl,
  ): Promise<Map<string, Set<PermissionType>>> {
    const resolved = await this.getEffectivePermissionDetails(user);
    const map = new Map<string, Set<PermissionType>>();
    for (const permission of resolved.values()) {
      if (!permission.granted) continue;
      if (!map.has(permission.moduleId)) {
        map.set(permission.moduleId, new Set<PermissionType>());
      }
      map.get(permission.moduleId)!.add(permission.permissionType);
    }
    return map;
  }

  /**
   * Effective permissions with their provenance, keyed by
   * `${moduleId}:${permissionType}`.
   */
  async getEffectivePermissionDetails(
    user: UserForAcl,
  ): Promise<Map<string, EffectivePermission>> {
    const tenantId = user.tenantId ?? getTenantId() ?? undefined;
    const cacheKey = this.cacheKey(user.id, tenantId);

    // The cache is JSON backed, so the map is stored as a flat array of
    // entries and rebuilt on read.
    const cached = await this.cache.get<EffectivePermission[]>(cacheKey);
    if (cached) {
      return new Map(
        cached.map((permission) => [
          `${permission.moduleId}:${permission.permissionType}`,
          permission,
        ]),
      );
    }

    const details = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) => this.compute(user, tx))
      : await this.compute(user, this.prisma);

    await this.cache.set(cacheKey, Array.from(details.values()), 300);
    return details;
  }

  async hasPermission(
    user: UserForAcl,
    moduleId: string,
    permissionType: PermissionType,
  ): Promise<boolean> {
    const details = await this.getEffectivePermissionDetails(user);
    return details.get(`${moduleId}:${permissionType}`)?.granted ?? false;
  }

  /**
   * True when the user is assigned any permission group or has any
   * permission override — i.e. their effective access is enhanced beyond
   * their base role. The UI uses this to show the `Role+` indicator.
   */
  async hasEnhancedPermissions(user: UserForAcl): Promise<boolean> {
    const details = await this.getEffectivePermissionDetails(user);

    for (const permission of details.values()) {
      const sources = permission.sources;
      if (sources.some((s) => s.type === 'GROUP' || s.type === 'OVERRIDE')) {
        return true;
      }
    }

    return false;
  }

  private async compute(
    user: UserForAcl,
    db: any,
  ): Promise<Map<string, EffectivePermission>> {
    const details = new Map<string, EffectivePermission>();

    const ensure = (moduleId: string, permissionType: PermissionType) => {
      const key = `${moduleId}:${permissionType}`;
      if (!details.has(key)) {
        details.set(key, {
          moduleId,
          permissionType,
          granted: false,
          sources: [],
        });
      }
      return details.get(key)!;
    };

    // 1. Base role permissions
    const rolePermissions = await db.roleModulePermission.findMany({
      where: { role: user.role },
      include: { permission: true },
    });

    for (const rolePermission of rolePermissions) {
      const entry = ensure(
        rolePermission.moduleId,
        rolePermission.permission.type,
      );
      entry.granted = true;
      entry.sources.push({ type: 'ROLE' });
    }

    // 2. Permission groups assigned to the user or their department
    const departmentIds = [user.departmentId, user.managedDepartmentId].filter(
      (id): id is string => !!id,
    );

    const assignments = await db.permissionGroupAssignment.findMany({
      where: {
        OR: [
          { userId: user.id },
          ...(departmentIds.length
            ? [{ departmentId: { in: departmentIds } }]
            : []),
        ],
      },
      include: {
        group: {
          include: {
            items: { include: { permission: true } },
          },
        },
      },
    });

    for (const assignment of assignments) {
      for (const item of assignment.group.items) {
        const entry = ensure(item.moduleId, item.permission.type);
        entry.granted = true;
        entry.sources.push({
          type: 'GROUP',
          groupId: assignment.group.id,
          groupName: assignment.group.name,
        });
      }
    }

    // 3. Per-user overrides win over everything above
    const overrides = await db.permissionOverride.findMany({
      where: { userId: user.id },
      include: { permission: true },
    });

    for (const override of overrides) {
      const entry = ensure(override.moduleId, override.permission.type);
      if (override.effect === PermissionEffect.GRANT) {
        entry.granted = true;
      } else {
        entry.granted = false;
      }
      entry.sources.push({
        type: 'OVERRIDE',
        effect: override.effect,
      });
    }

    return details;
  }

  /** Drop cached effective permissions for a user. */
  async invalidateUserCache(userId: string, tenantId?: string): Promise<void> {
    await this.cache.del(this.cacheKey(userId, tenantId));
    await this.cache.del(
      this.cache.tenantKey(`user:${userId}:modules`, tenantId),
    );
  }

  /** Drop every cached entry for a tenant. */
  async invalidateTenantCache(tenantId: string): Promise<void> {
    await this.cache.flushTenant(tenantId);
  }
}
