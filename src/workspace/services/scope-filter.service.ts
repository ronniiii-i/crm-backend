import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityDescriptor, ScopeName, WhereInput } from '../types/entity';
import { WorkspaceActor } from '../types/actor';

interface ScopeContext {
  scope: ScopeName;
  where: WhereInput;
}

/**
 * Builds the server-side predicate that limits a query to the caller's
 * effective data scope.
 *
 * Scope rules follow the Phase 3 matrix (plan section 6.4). If the effective
 * scope is not supported by an entity we throw `403` instead of silently
 * returning an empty page, so the UI can explain why access is denied.
 */
@Injectable()
export class ScopeFilterService {
  constructor(private readonly prisma: PrismaService) {}

  /** UI checkbox scope overrides the role scope only when configured. */
  effectiveScope(
    descriptor: EntityDescriptor,
    actor: WorkspaceActor,
    moduleScope?: string | null,
  ): ScopeName {
    const scope = (
      moduleScope && moduleScope.length > 0
        ? moduleScope
        : actor.isTenantAdmin
          ? 'TENANT'
          : actor.dataScope
    ) as ScopeName;

    if (!descriptor.supportedScopes.includes(scope)) {
      throw new ForbiddenException({
        code: 'SCOPE_NOT_SUPPORTED',
        message: `The ${scope} scope is not available for ${descriptor.label}.`,
        entity: descriptor.key,
        scope,
        supportedScopes: descriptor.supportedScopes,
      });
    }

    return scope;
  }

  async build(
    descriptor: EntityDescriptor,
    actor: WorkspaceActor,
    moduleScope?: string | null,
  ): Promise<ScopeContext> {
    const scope = this.effectiveScope(descriptor, actor, moduleScope);

    switch (scope) {
      case 'TENANT':
        return { scope, where: { tenantId: actor.tenantId } };

      case 'DEPARTMENT': {
        const departmentId =
          actor.managedDepartmentId ?? actor.departmentId ?? null;

        if (!departmentId) {
          throw new ForbiddenException({
            code: 'NO_DEPARTMENT',
            message:
              'Your account is not assigned to a department, so department-scoped data is unavailable.',
            entity: descriptor.key,
            scope,
          });
        }

        return {
          scope,
          where: this.departmentWhere(descriptor, actor, departmentId),
        };
      }

      case 'TEAM': {
        const teamMemberIds = await this.resolveTeamMemberIds(
          actor.tenantId,
          actor.id,
        );

        return {
          scope,
          where: this.userWhere(descriptor, actor, { in: teamMemberIds }),
        };
      }

      case 'SELF':
        return {
          scope,
          where: this.userWhere(descriptor, actor, actor.id),
        };
    }
  }

  /**
   * Team ids for the caller: teams they lead plus teams they belong to. The
   * caller is always included so a lead who has no membership row still sees
   * their own records.
   */
  async resolveTeamMemberIds(
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const teams = await tx.team.findMany({
        where: {
          tenantId,
          OR: [{ leadUserId: userId }, { members: { some: { userId } } }],
        },
        select: { id: true },
      });

      if (teams.length === 0) {
        return [userId];
      }

      const members = await tx.teamMember.findMany({
        where: {
          tenantId,
          teamId: { in: teams.map((team) => team.id) },
        },
        select: { userId: true },
      });

      return Array.from(new Set([userId, ...members.map((m) => m.userId)]));
    });
  }

  private departmentWhere(
    descriptor: EntityDescriptor,
    actor: WorkspaceActor,
    departmentId: string,
  ): WhereInput {
    // Shared catalogue: every scope sees the whole tenant inventory.
    if (descriptor.key === 'inventory_items') {
      return { tenantId: actor.tenantId };
    }

    if (descriptor.owner.departmentField) {
      return { [descriptor.owner.departmentField]: departmentId };
    }

    if (descriptor.owner.departmentVia) {
      return nested(descriptor.owner.departmentVia, { departmentId });
    }

    throw new ForbiddenException({
      code: 'SCOPE_UNMAPPED',
      message: `Department scope is not mapped for ${descriptor.label}.`,
      entity: descriptor.key,
    });
  }

  private userWhere(
    descriptor: EntityDescriptor,
    actor: WorkspaceActor,
    value: string | { in: string[] },
  ): WhereInput {
    // Shared catalogue: every scope sees the whole tenant inventory.
    if (descriptor.key === 'inventory_items') {
      return { tenantId: actor.tenantId };
    }

    if (descriptor.owner.userField) {
      return { [descriptor.owner.userField]: value };
    }

    if (descriptor.owner.userVia) {
      return nested(descriptor.owner.userVia, { userId: value });
    }

    throw new ForbiddenException({
      code: 'SCOPE_UNMAPPED',
      message: `User scope is not mapped for ${descriptor.label}.`,
      entity: descriptor.key,
    });
  }
}

/** Wrap a leaf predicate in a dotted relation path. */
export function nested(path: string, leaf: WhereInput): WhereInput {
  const parts = path.split('.').filter(Boolean);
  let result: WhereInput = leaf;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    result = { [parts[index]]: result };
  }
  return result;
}
