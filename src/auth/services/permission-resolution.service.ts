import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { getTenantId } from '../../tenant/tenant-context';
import {
  PermissionType,
  PermissionEffect,
  RoleDataScope,
} from '@prisma/client';
import { UserForAcl } from '../permission-types';

/** Where a permission came from. Used by the UI to render `Role+` badges. */
export type PermissionSourceType = 'ROLE' | 'GROUP' | 'OVERRIDE';

export interface PermissionSource {
  type: PermissionSourceType;
  effect?: PermissionEffect;
  /** Role that produced this source (ROLE sources only). */
  roleId?: string;
  roleSlug?: string;
  roleName?: string;
  /** True when the role is an ancestor of the actor's direct role. */
  inherited?: boolean;
  groupId?: string;
  groupName?: string;
}

export interface EffectivePermission {
  moduleId: string;
  permissionType: PermissionType;
  granted: boolean;
  sources: PermissionSource[];
}

/** One role in the root -> child inheritance chain. */
export interface RoleChainEntry {
  id: string;
  slug: string;
  name: string;
  rank: number;
  dataScope: RoleDataScope;
  isTenantAdmin: boolean;
  parentRoleId: string | null;
}

export interface HasPermissionParams {
  userId: string;
  tenantId: string;
  moduleKey: string;
  action: PermissionType;
  roleId: string;
  departmentId: string | null;
  managedDepartmentId: string | null;
  dataScope: string;
  isTenantAdmin: boolean;
}

const MAX_ROLE_CHAIN_DEPTH = 8;
const ROLE_CHAIN_TTL_SECONDS = 10 * 60;

/**
 * Resolves the effective permission set for a user using the hybrid ACL model:
 *
 *   1. Base role permissions (RoleModulePermission), walking the role's
 *      inheritance chain root -> child so a child GRANT/REVOKE wins.
 *   2. Permission groups assigned directly to the user or to their department
 *   3. Per-user overrides (GRANT/REVOKE) — highest precedence
 *
 * All lookups run inside a tenant transaction so Postgres RLS applies.
 * Inheritance never widens the actor's own data scope and `isTenantAdmin`
 * is never inherited.
 */
@Injectable()
export class PermissionResolutionService {
  private readonly logger = new Logger(PermissionResolutionService.name);

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

  private roleChainCacheKey(roleId: string, tenantId?: string): string {
    return this.cache.tenantKey(`role-chain:${roleId}`, tenantId);
  }

  /**
   * Root -> child role inheritance chain for a role, capped at
   * `MAX_ROLE_CHAIN_DEPTH`. Cycles are logged and truncated rather than
   * looping forever. Results are cached for 10 minutes and invalidated with
   * the tenant ACL bump.
   */
  async getRoleChain(
    roleId: string,
    tenantId?: string,
  ): Promise<RoleChainEntry[]> {
    if (!roleId) return [];

    const cacheKey = this.roleChainCacheKey(roleId, tenantId);
    const cached = await this.cache.get<RoleChainEntry[]>(cacheKey);
    if (cached) return cached;

    const load = (db: any) => this.loadRoleChain(db, roleId, tenantId);
    const chain = tenantId
      ? await this.prisma.withTenant(tenantId, load)
      : await load(this.prisma);

    await this.cache.set(cacheKey, chain, ROLE_CHAIN_TTL_SECONDS);
    return chain;
  }

  private async loadRoleChain(
    db: any,
    roleId: string,
    tenantId?: string,
  ): Promise<RoleChainEntry[]> {
    const chain: RoleChainEntry[] = [];
    const seen = new Set<string>();
    let current: string | null = roleId;
    let depth = 0;

    while (current && depth < MAX_ROLE_CHAIN_DEPTH) {
      if (seen.has(current)) {
        this.logger.error(
          `Role inheritance cycle detected at role ${current} (tenant ${
            tenantId ?? 'unknown'
          }); truncating chain.`,
        );
        break;
      }
      seen.add(current);

      const role = await db.role?.findFirst?.({
        where: {
          id: current,
          ...(tenantId ? { tenantId } : {}),
        },
      });

      if (!role) {
        // Fixtures and legacy callers may key permissions by an opaque role
        // id with no `roles` row. Treat that as a single-role chain.
        if (depth === 0) {
          chain.push(syntheticRole(roleId));
        }
        break;
      }

      chain.push({
        id: role.id,
        slug: role.slug ?? role.id,
        name: role.name ?? role.slug ?? role.id,
        rank: typeof role.rank === 'number' ? role.rank : 0,
        dataScope: role.dataScope ?? RoleDataScope.SELF,
        isTenantAdmin: role.isTenantAdmin === true,
        parentRoleId: role.parentRoleId ?? null,
      });

      current = role.parentRoleId ?? null;
      depth += 1;
    }

    if (current && depth >= MAX_ROLE_CHAIN_DEPTH) {
      this.logger.warn(
        `Role inheritance chain for ${roleId} exceeded ${MAX_ROLE_CHAIN_DEPTH} levels; truncating.`,
      );
    }

    // Resolver walks root -> child so later (child) rows override earlier ones.
    return chain.reverse();
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

    const roleId = getRoleId(user);
    const chain = roleId ? await this.getRoleChain(roleId, tenantId) : [];

    const details = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) =>
          this.compute(user, tx, chain),
        )
      : await this.compute(user, this.prisma, chain);

    await this.cache.set(cacheKey, Array.from(details.values()), 300);
    return details;
  }

  /**
   * Check whether a user has a specific permission.
   * Supports either:
   *   1. HasPermissionParams (key-based, used by PermissionGuard)
   *   2. (user, moduleId, permissionType) (id-based, used by legacy check-permission API)
   */
  async hasPermission(params: HasPermissionParams): Promise<boolean>;
  async hasPermission(
    user: UserForAcl,
    moduleId: string,
    permissionType: PermissionType,
  ): Promise<boolean>;
  async hasPermission(
    paramsOrUser: HasPermissionParams | UserForAcl,
    moduleId?: string,
    permissionType?: PermissionType,
  ): Promise<boolean> {
    if ('moduleKey' in paramsOrUser) {
      const { userId, tenantId, moduleKey, action, roleId, isTenantAdmin } =
        paramsOrUser;

      // Tenant admins always have all permissions
      if (isTenantAdmin) return true;

      // Resolve moduleId from key within the tenant
      const module = await this.prisma.withTenant(tenantId, (tx) =>
        tx.module.findFirst({
          where: { tenantId, key: moduleKey },
          select: { id: true },
        }),
      );
      if (!module) return false;

      const user: UserForAcl = {
        id: userId,
        role: roleId, // satisfies UserForAcl.role (string)
        tenantId,
        departmentId: paramsOrUser.departmentId,
        managedDepartmentId: paramsOrUser.managedDepartmentId,
      };

      const details = await this.getEffectivePermissionDetails(user);
      return details.get(`${module.id}:${action}`)?.granted ?? false;
    }

    const details = await this.getEffectivePermissionDetails(paramsOrUser);
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
    chain: RoleChainEntry[],
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

    // 1. Base role permissions, walking the inheritance chain root -> child.
    const currentRoleId = getRoleId(user);
    const effectiveChain =
      chain.length > 0
        ? chain
        : currentRoleId
          ? [syntheticRole(currentRoleId)]
          : [];

    if (effectiveChain.length > 0) {
      const roleIds = effectiveChain.map((role) => role.id);
      const rolePermissions = await db.roleModulePermission.findMany({
        where: {
          roleId: { in: roleIds },
          ...(user.tenantId ? { tenantId: user.tenantId } : {}),
        },
        include: { permission: true },
      });

      const byRole = new Map<string, any[]>();
      for (const rolePermission of rolePermissions) {
        const roleId =
          rolePermission.roleId ??
          rolePermission.role ??
          rolePermission.role?.id;
        if (!roleId) continue;
        if (!byRole.has(roleId)) byRole.set(roleId, []);
        byRole.get(roleId)!.push(rolePermission);
      }

      for (const role of effectiveChain) {
        for (const rolePermission of byRole.get(role.id) ?? []) {
          const entry = ensure(
            rolePermission.moduleId,
            rolePermission.permission?.type ?? rolePermission.permissionType,
          );
          const effect =
            rolePermission.effect === PermissionEffect.REVOKE
              ? PermissionEffect.REVOKE
              : PermissionEffect.GRANT;

          // Child wins over parent: each row overwrites the granted flag.
          entry.granted = effect === PermissionEffect.GRANT;
          entry.sources.push({
            type: 'ROLE',
            effect,
            roleId: role.id,
            roleSlug: role.slug,
            roleName: role.name,
            inherited: role.id !== currentRoleId,
          });
        }
      }
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

  /** Drop cached effective permissions and navigation payloads for a user. */
  async invalidateUserCache(userId: string, tenantId?: string): Promise<void> {
    await this.cache.invalidateUser(userId, tenantId);
  }

  /** Drop every cached entry for a tenant. */
  async invalidateTenantCache(tenantId: string): Promise<void> {
    await this.cache.flushTenant(tenantId);
  }
}

function getRoleId(user: UserForAcl): string | null {
  const candidate =
    (user as any).roleId ?? (user as any).role?.id ?? (user as any).role;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

function syntheticRole(roleId: string): RoleChainEntry {
  return {
    id: roleId,
    slug: roleId,
    name: roleId,
    rank: 0,
    dataScope: RoleDataScope.SELF,
    isTenantAdmin: false,
    parentRoleId: null,
  };
}
