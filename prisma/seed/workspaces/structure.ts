import { EmploymentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PERMISSION_TYPES, RoleSlug } from '../defaults';
import { TenantProvisioningService } from '../../../src/tenant/tenant-provisioning.service';
import {
  WorkspaceTemplate,
  WorkspaceTemplateKey,
} from '../../../src/tenant/templates';

const provisioning = new TenantProvisioningService();

/**
 * Shared, idempotent workspace structure helpers for the seed workspaces.
 *
 * Provisioning creates the initial structure for brand-new tenants. These
 * helpers also upgrade an existing tenant in place (for example an `acme`
 * workspace created by an older seed) without deleting anything.
 */

export interface TemplateStructure {
  departmentIdByKey: Map<string, string>;
  roleIdBySlug: Map<string, string>;
  moduleIdByKey: Map<string, string>;
}

export interface SeedUserInput {
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roleId: string;
  departmentId?: string | null;
  isVerified?: boolean;
}

export interface SeedTenantSpec {
  slug: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  template: WorkspaceTemplateKey;
}

/**
 * Finds the tenant by slug or provisions a new one. Existing tenants are
 * updated in place; nothing is deleted.
 */
export async function ensureProvisionedTenant(
  tx: Prisma.TransactionClient,
  spec: SeedTenantSpec,
): Promise<string> {
  const existing = await tx.tenant.findUnique({
    where: { slug: spec.slug },
    select: { id: true },
  });

  if (existing) {
    await tx.tenant.update({
      where: { id: existing.id },
      data: {
        name: spec.name,
        ownerEmail: spec.ownerEmail,
        ownerName: spec.ownerName,
      },
    });
    return existing.id;
  }

  const tenantId = randomUUID();
  await provisioning.provisionTenantData(
    tx,
    {
      tenantId,
      workspaceName: spec.name,
      slug: spec.slug,
      ownerEmail: spec.ownerEmail,
      ownerName: spec.ownerName,
    },
    {
      template: spec.template,
      allowDemoTemplate: true,
    },
  );

  return tenantId;
}

/** Upserts departments, roles, modules, and role/module grants. */
export async function ensureTemplateStructure(
  tx: Prisma.TransactionClient,
  tenantId: string,
  template: WorkspaceTemplate,
): Promise<TemplateStructure> {
  for (const department of template.departments) {
    await tx.department.upsert({
      where: { tenantId_key: { tenantId, key: department.key } },
      update: {
        name: department.name,
        sortOrder: department.sortOrder,
        isSystem: true,
      },
      create: {
        tenantId,
        key: department.key,
        name: department.name,
        sortOrder: department.sortOrder,
        isSystem: true,
      },
    });
  }

  const departments = await tx.department.findMany({
    where: { tenantId },
    select: { id: true, key: true },
  });
  const departmentIdByKey = new Map(
    departments.map((department) => [department.key, department.id]),
  );

  for (const role of template.roles) {
    await tx.role.upsert({
      where: { tenantId_slug: { tenantId, slug: role.slug } },
      update: {
        name: role.name,
        description: role.description,
        rank: role.rank,
        dataScope: role.dataScope,
        isSystem: role.isSystem,
        isTenantAdmin: role.isTenantAdmin,
      },
      create: {
        tenantId,
        slug: role.slug,
        name: role.name,
        description: role.description,
        rank: role.rank,
        dataScope: role.dataScope,
        isSystem: role.isSystem,
        isTenantAdmin: role.isTenantAdmin,
      },
    });
  }

  const roles = await tx.role.findMany({
    where: { tenantId },
    select: { id: true, slug: true },
  });
  const roleIdBySlug = new Map(roles.map((role) => [role.slug, role.id]));

  for (const module of template.modules) {
    const departmentId = module.departmentKey
      ? departmentIdByKey.get(module.departmentKey)
      : null;

    if (module.departmentKey && !departmentId) {
      throw new Error(
        `Module "${module.key}" references unknown department "${module.departmentKey}".`,
      );
    }

    const data = {
      name: module.name,
      path: module.departmentKey
        ? `/dept/${module.departmentKey}/${module.key}`
        : module.path,
      icon: module.icon ?? null,
      group: module.group,
      order: module.order,
      isNavigable: module.isNavigable,
      departmentId,
      type: module.type,
      targetEntity: module.targetEntity,
      config: module.config as Prisma.InputJsonValue,
      dataScope: null,
      isActive: true,
    };

    await tx.module.upsert({
      where: { tenantId_key: { tenantId, key: module.key } },
      update: data,
      create: {
        tenantId,
        key: module.key,
        ...data,
      },
    });
  }

  const modules = await tx.module.findMany({
    where: { tenantId },
    select: { id: true, key: true },
  });
  const moduleIdByKey = new Map(
    modules.map((module) => [module.key, module.id]),
  );

  const permissions = await tx.permission.findMany({
    where: { type: { in: PERMISSION_TYPES } },
    select: { id: true, type: true },
  });
  const permissionByType = new Map(
    permissions.map((permission) => [permission.type, permission.id]),
  );

  const grants: Prisma.RoleModulePermissionCreateManyInput[] = [];
  const seen = new Set<string>();

  for (const module of template.modules) {
    const moduleId = moduleIdByKey.get(module.key);
    if (!moduleId) {
      throw new Error(
        `Module "${module.key}" was not created for ${tenantId}.`,
      );
    }

    for (const roleSlug of Object.keys(
      module.defaultPermissions,
    ) as RoleSlug[]) {
      const roleId = roleIdBySlug.get(roleSlug);
      if (!roleId) {
        throw new Error(`Role "${roleSlug}" was not created for ${tenantId}.`);
      }

      for (const permissionType of module.defaultPermissions[roleSlug]) {
        const permissionId = permissionByType.get(permissionType);
        if (!permissionId) {
          throw new Error(
            `Permission "${permissionType}" is missing from the catalogue.`,
          );
        }

        const key = `${roleId}:${moduleId}:${permissionId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        grants.push({ tenantId, roleId, moduleId, permissionId });
      }
    }
  }

  await tx.roleModulePermission.createMany({
    data: grants,
    skipDuplicates: true,
  });

  return { departmentIdByKey, roleIdBySlug, moduleIdByKey };
}

/** Upserts a verified (or explicitly unverified) workspace user. */
export async function upsertSeedUser(
  tx: Prisma.TransactionClient,
  input: SeedUserInput,
) {
  const email = input.email.trim().toLowerCase();

  return tx.user.upsert({
    where: { tenantId_email: { tenantId: input.tenantId, email } },
    update: {
      name: input.name,
      password: input.passwordHash,
      roleId: input.roleId,
      departmentId: input.departmentId ?? null,
      status: EmploymentStatus.ACTIVE,
      isVerified: input.isVerified ?? true,
      verifyTokenHash: null,
      verifyExpiresAt: null,
    },
    create: {
      tenantId: input.tenantId,
      email,
      name: input.name,
      password: input.passwordHash,
      roleId: input.roleId,
      departmentId: input.departmentId ?? null,
      status: EmploymentStatus.ACTIVE,
      isVerified: input.isVerified ?? true,
    },
    select: { id: true, email: true },
  });
}

export async function refreshTenantSeatCount(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<number> {
  const seatCount = await tx.user.count({ where: { tenantId } });
  await tx.tenant.update({ where: { id: tenantId }, data: { seatCount } });
  return seatCount;
}

export async function findOrCreateTeam(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    name: string;
    description?: string;
    departmentId: string;
    leadUserId?: string | null;
  },
) {
  const existing = await tx.team.findFirst({
    where: { tenantId: input.tenantId, name: input.name },
    select: { id: true },
  });

  if (existing) {
    return tx.team.update({
      where: { id: existing.id },
      data: {
        description: input.description,
        departmentId: input.departmentId,
        leadUserId: input.leadUserId ?? null,
      },
      select: { id: true },
    });
  }

  return tx.team.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      departmentId: input.departmentId,
      leadUserId: input.leadUserId ?? null,
    },
    select: { id: true },
  });
}

export async function ensureTeamMember(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    teamId: string;
    userId: string;
    role?: string;
  },
): Promise<void> {
  await tx.teamMember.upsert({
    where: {
      teamId_userId: { teamId: input.teamId, userId: input.userId },
    },
    update: { role: input.role ?? 'Member' },
    create: {
      tenantId: input.tenantId,
      teamId: input.teamId,
      userId: input.userId,
      role: input.role ?? 'Member',
    },
  });
}
