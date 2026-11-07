import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const MAX_ROLE_CHAIN_DEPTH = 8;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

interface RoleShape {
  id?: string;
  rank: number;
  isTenantAdmin: boolean;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** RLS requires `app.current_tenant` on the querying connection. */
  private scoped<T>(
    tenantId: string,
    fn: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(tenantId, fn);
  }

  async list(tenantId: string) {
    const roles = await this.scoped(tenantId, (tx) =>
      tx.role.findMany({
        where: { tenantId },
        include: {
          parentRole: {
            select: { id: true, name: true, slug: true, rank: true },
          },
          childRoles: {
            select: { id: true, name: true, slug: true, rank: true },
          },
          _count: {
            select: {
              users: true,
              roleModulePermissions: true,
              invitations: true,
            },
          },
        },
        orderBy: [{ isTenantAdmin: 'desc' }, { rank: 'asc' }, { name: 'asc' }],
      }),
    );
    return { success: true, roles };
  }

  async assignable(tenantId: string, user: any) {
    const roles = await this.scoped(tenantId, (tx) =>
      tx.role.findMany({
        where: { tenantId },
        orderBy: [{ rank: 'asc' }, { name: 'asc' }],
      }),
    );
    const filtered = roles.filter((r) => {
      if (r.isTenantAdmin) return false;
      if (user?.isTenantAdmin) return true;
      if (!user?.roleRank) return false;
      return r.rank >= user.roleRank;
    });
    return { success: true, roles: filtered };
  }

  async get(tenantId: string, id: string) {
    const role = await this.scoped(tenantId, (tx) =>
      tx.role.findFirst({
        where: { id, tenantId },
        include: {
          parentRole: {
            select: { id: true, name: true, slug: true, rank: true },
          },
          childRoles: {
            select: { id: true, name: true, slug: true, rank: true },
          },
        },
      }),
    );
    if (!role) throw new NotFoundException('Role not found');
    return { success: true, role };
  }

  async create(tenantId: string, user: any, dto: CreateRoleDto) {
    if (dto.dataScope === 'TENANT') {
      throw new BadRequestException('Custom roles cannot use TENANT scope');
    }
    if (dto.rank && (dto.rank < 1 || dto.rank > 999)) {
      throw new BadRequestException('Rank must be between 1 and 999');
    }

    const slug = slugify(dto.name);
    if (!slug) throw new BadRequestException('Role name is required');

    const role = await this.scoped(tenantId, async (tx) => {
      const existing = await tx.role.findFirst({
        where: { tenantId, slug },
      });
      if (existing) throw new ConflictException('Role already exists');

      const rank = dto.rank ?? 500;
      const parent = await this.assertParentValid(
        tx,
        tenantId,
        {
          rank,
          isTenantAdmin: false,
        },
        dto.parentRoleId,
      );

      const created = await tx.role.create({
        data: {
          tenantId,
          name: dto.name,
          slug,
          description: dto.description,
          rank,
          dataScope: dto.dataScope ?? 'SELF',
          isSystem: false,
          isTenantAdmin: false,
          parentRoleId: parent?.id ?? null,
        },
        include: {
          parentRole: { select: { id: true, name: true, slug: true } },
        },
      });

      if (parent) {
        await this.recordAudit(
          tx,
          tenantId,
          user,
          created.id,
          'ROLE_CREATE',
          {
            parentRoleId: null,
            parentRoleSlug: null,
          },
          {
            parentRoleId: parent.id,
            parentRoleSlug: parent.slug,
          },
        );
      }

      return created;
    });

    await this.cache.invalidateTenantAcls(tenantId);
    return { success: true, role };
  }

  async update(tenantId: string, user: any, id: string, dto: UpdateRoleDto) {
    const updated = await this.scoped(tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id, tenantId } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isTenantAdmin) {
        if (dto.rank !== undefined || dto.dataScope !== undefined) {
          throw new BadRequestException('Tenant admin role is immutable');
        }
        if (dto.name)
          throw new BadRequestException('Tenant admin role cannot be renamed');
        if (dto.parentRoleId !== undefined)
          throw new BadRequestException(
            'Tenant admin role cannot inherit from another role',
          );
      }
      if (role.isSystem && dto.name)
        throw new BadRequestException('System role name cannot be changed');
      if (dto.dataScope === 'TENANT' && !role.isTenantAdmin) {
        throw new BadRequestException('Custom roles cannot use TENANT scope');
      }

      const nextRank = dto.rank ?? role.rank;
      const parentChanged = dto.parentRoleId !== undefined;
      const nextParentId = parentChanged ? dto.parentRoleId : role.parentRoleId;

      if (role.isTenantAdmin && nextParentId) {
        throw new BadRequestException(
          'Tenant admin role cannot inherit from another role',
        );
      }

      const parent = await this.assertParentValid(
        tx,
        tenantId,
        {
          id: role.id,
          rank: nextRank,
          isTenantAdmin: role.isTenantAdmin,
        },
        nextParentId,
      );

      if (dto.rank !== undefined && dto.rank !== role.rank) {
        const children = await tx.role.findMany({
          where: { tenantId, parentRoleId: role.id },
          select: { id: true, name: true, rank: true },
        });
        const invalidChild = children.find((child) => child.rank <= nextRank);
        if (invalidChild) {
          throw new BadRequestException(
            `Rank ${nextRank} would make "${invalidChild.name}" (rank ${invalidChild.rank}) inherit from a more privileged role.`,
          );
        }
      }

      const result = await tx.role.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          rank: dto.rank,
          dataScope: dto.dataScope,
          parentRoleId: parentChanged ? (parent?.id ?? null) : undefined,
        },
        include: {
          parentRole: { select: { id: true, name: true, slug: true } },
        },
      });

      if (dto.dataScope && dto.dataScope !== role.dataScope) {
        // Bumping the session version invalidates cached role claims so the
        // new data scope applies on the next request.
        await tx.user.updateMany({
          where: { tenantId, roleId: id },
          data: { sessionVersion: { increment: 1 } },
        });
      }

      if (
        parentChanged &&
        (role.parentRoleId ?? null) !== (parent?.id ?? null)
      ) {
        const previousParent = role.parentRoleId
          ? await tx.role.findFirst({
              where: { id: role.parentRoleId, tenantId },
              select: { id: true, slug: true },
            })
          : null;
        await this.recordAudit(
          tx,
          tenantId,
          user,
          role.id,
          'ROLE_PARENT_CHANGE',
          {
            parentRoleId: previousParent?.id ?? null,
            parentRoleSlug: previousParent?.slug ?? null,
          },
          {
            parentRoleId: parent?.id ?? null,
            parentRoleSlug: parent?.slug ?? null,
          },
        );
      }

      return { role, result };
    });

    await this.cache.invalidateTenantAcls(tenantId);

    return { success: true, role: updated.result };
  }

  async remove(tenantId: string, id: string) {
    await this.scoped(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId },
        include: { _count: { select: { users: true, invitations: true } } },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isTenantAdmin)
        throw new ForbiddenException('Tenant admin role cannot be deleted');
      if (role.isSystem)
        throw new ForbiddenException('System role cannot be deleted');
      if (role._count.users > 0 || role._count.invitations > 0) {
        throw new ConflictException({
          message: 'Role has assigned users or pending invitations',
          users: role._count.users,
          invitations: role._count.invitations,
        });
      }

      await tx.role.delete({ where: { id } });
    });

    await this.cache.invalidateTenantAcls(tenantId);
    return { success: true };
  }

  /**
   * Validates a prospective parent link.
   *
   * Rules: the parent must exist in the same tenant, must not be the role
   * itself, must not be the tenant admin role, must be less privileged (lower
   * rank) than the child, and must not create a cycle or exceed the depth cap.
   */
  private async assertParentValid(
    tx: Prisma.TransactionClient,
    tenantId: string,
    child: RoleShape,
    parentRoleId: string | null | undefined,
  ) {
    if (!parentRoleId) return null;

    if (child.isTenantAdmin) {
      throw new BadRequestException(
        'Tenant admin role cannot inherit from another role',
      );
    }
    if (child.id && parentRoleId === child.id) {
      throw new BadRequestException('A role cannot inherit from itself');
    }

    const parent = await tx.role.findFirst({
      where: { id: parentRoleId, tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        rank: true,
        isTenantAdmin: true,
        parentRoleId: true,
      },
    });
    if (!parent) throw new BadRequestException('Parent role not found');
    if (parent.isTenantAdmin) {
      throw new BadRequestException(
        'The tenant admin role cannot be used as a parent',
      );
    }
    if (parent.rank >= child.rank) {
      throw new BadRequestException(
        'Parent role must be less privileged than the child role',
      );
    }

    let current = parent;
    const seen = new Set<string>();
    if (child.id) seen.add(child.id);
    // child + parent = 2 roles.
    let depth = 2;

    while (current.parentRoleId) {
      if (depth >= MAX_ROLE_CHAIN_DEPTH) {
        throw new BadRequestException(
          `Role inheritance cannot exceed ${MAX_ROLE_CHAIN_DEPTH} levels`,
        );
      }
      if (seen.has(current.parentRoleId)) {
        throw new BadRequestException('Role inheritance cycle detected');
      }
      seen.add(current.parentRoleId);

      const next = await tx.role.findFirst({
        where: { id: current.parentRoleId, tenantId },
        select: {
          id: true,
          slug: true,
          name: true,
          rank: true,
          isTenantAdmin: true,
          parentRoleId: true,
        },
      });
      if (!next) break;
      if (child.id && next.id === child.id) {
        throw new BadRequestException('Role inheritance cycle detected');
      }
      current = next;
      depth += 1;
    }

    if (depth > MAX_ROLE_CHAIN_DEPTH) {
      throw new BadRequestException(
        `Role inheritance cannot exceed ${MAX_ROLE_CHAIN_DEPTH} levels`,
      );
    }

    return parent;
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    user: any,
    roleId: string,
    action: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: user?.id ?? user?.sub ?? null,
        action,
        entity: 'role',
        entityId: roleId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
