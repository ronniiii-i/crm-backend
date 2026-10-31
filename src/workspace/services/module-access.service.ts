import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Department, Module, PermissionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionResolutionService } from '../../auth/services/permission-resolution.service';
import { EntityDescriptor, ScopeName } from '../types/entity';
import { ModuleConfig } from '../types/module-config';
import { WorkspaceActor, toWorkspaceActor } from '../types/actor';
import { EntityRegistryService } from './entity-registry.service';
import { ModuleConfigService } from './module-config.service';
import { ScopeFilterService } from './scope-filter.service';

export type ModuleAction = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE';

const ALL_ACTIONS: ModuleAction[] = ['VIEW', 'CREATE', 'EDIT', 'DELETE'];

export interface ResolvedModuleAccess {
  actor: WorkspaceActor;
  module: Module & { department: Department | null };
  department: Department | null;
  config: ModuleConfig;
  entity: EntityDescriptor | null;
  actions: ModuleAction[];
  /** Effective data scope, validated against the entity allowlist. */
  scope: ScopeName;
}

interface AuthUserLike {
  id?: string;
  sub?: string;
  userId?: string;
  tenantId?: string;
  roleId?: string;
  roleSlug?: string;
  dataScope?: string;
  departmentId?: string | null;
  managedDepartmentId?: string | null;
  isTenantAdmin?: boolean;
}

/**
 * Resolves a module from `(tenantId, departmentKey, moduleKey)` and computes
 * the caller's effective actions and data scope.
 *
 * Every workspace route goes through here, so a module that is missing,
 * inactive, or in a different department is indistinguishable from a module
 * that does not exist (`404`) — no cross-department probing.
 */
@Injectable()
export class ModuleAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolutionService,
    private readonly registry: EntityRegistryService,
    private readonly configs: ModuleConfigService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async resolve(
    user: AuthUserLike,
    deptKey: string,
    moduleKey: string,
  ): Promise<ResolvedModuleAccess> {
    const actor = toWorkspaceActor(user);

    const module = await this.prisma.withTenant(actor.tenantId, (tx) =>
      tx.module.findFirst({
        where: {
          tenantId: actor.tenantId,
          key: moduleKey,
          isActive: true,
          department: { key: deptKey },
        },
        include: { department: true },
      }),
    );

    if (!module) {
      throw new NotFoundException({
        code: 'MODULE_NOT_FOUND',
        message: `Module "${deptKey}/${moduleKey}" was not found.`,
      });
    }

    const entity = this.registry.forModule(module.targetEntity);
    const actions = await this.resolveActions(actor, module, entity);
    const config = this.configs.normalize(module);
    const scope = entity
      ? this.scopes.effectiveScope(entity, actor, module.dataScope)
      : ((module.dataScope ?? (actor.isTenantAdmin ? 'TENANT' : actor.dataScope)) as ScopeName);

    return {
      actor,
      module,
      department: module.department,
      config,
      entity,
      actions,
      scope,
    };
  }

  /** Resolve and assert a specific action in one call (used by the guard). */
  async requireAction(
    user: AuthUserLike,
    deptKey: string,
    moduleKey: string,
    action: ModuleAction,
  ): Promise<ResolvedModuleAccess> {
    const access = await this.resolve(user, deptKey, moduleKey);
    this.assertAction(access, action);
    return access;
  }

  assertAction(access: ResolvedModuleAccess, action: ModuleAction): void {
    if (!access.actions.includes(action)) {
      throw new ForbiddenException({
        code: 'MODULE_FORBIDDEN',
        message: `You do not have ${action} permission for ${access.module.name}.`,
        moduleKey: access.module.key,
        action,
      });
    }
  }

  assertTenantAdmin(access: ResolvedModuleAccess): void {
    if (!access.actor.isTenantAdmin) {
      throw new ForbiddenException({
        code: 'TENANT_ADMIN_REQUIRED',
        message: 'Only a workspace administrator can change module configuration.',
        moduleKey: access.module.key,
      });
    }
  }

  /** Payload for `GET /workspace/modules/:deptKey/:moduleKey`. */
  definition(access: ResolvedModuleAccess) {
    const { module, department, entity } = access;

    return {
      id: module.id,
      key: module.key,
      path: module.path,
      name: module.name,
      icon: module.icon,
      group: module.group,
      order: module.order,
      type: module.type,
      targetEntity: module.targetEntity,
      config: access.config,
      isNavigable: module.isNavigable,
      description: module.description,
      department: department
        ? {
            id: department.id,
            key: department.key,
            name: department.name,
            sortOrder: department.sortOrder,
          }
        : null,
      dataScope: access.scope,
      actions: access.actions,
      entityMeta: entity ? this.registry.describe(entity) : null,
    };
  }

  private async resolveActions(
    actor: WorkspaceActor,
    module: Module,
    entity: EntityDescriptor | null,
  ): Promise<ModuleAction[]> {
    const readOnly = entity?.readOnly === true;

    if (actor.isTenantAdmin) {
      return readOnly ? ['VIEW'] : [...ALL_ACTIONS];
    }

    const effective = await this.permissions.getEffectivePermissions({
      id: actor.id,
      role: actor.roleId,
      tenantId: actor.tenantId,
      departmentId: actor.departmentId,
      managedDepartmentId: actor.managedDepartmentId,
    });

    const granted = effective.get(module.id) ?? new Set<PermissionType>();
    const actions = ALL_ACTIONS.filter(
      (action) => granted.has(action as PermissionType),
    );

    return readOnly ? actions.filter((action) => action === 'VIEW') : actions;
  }
}
