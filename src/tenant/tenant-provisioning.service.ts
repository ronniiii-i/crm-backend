import { Injectable } from '@nestjs/common';
import { Prisma, Tenant, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_MODULES,
  DEFAULT_ROLES,
  DEFAULT_TRIAL_DAYS,
  PERMISSION_TYPES,
  RoleSlug,
} from './defaults';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface ProvisionTenantParams {
  /** Stable id chosen by the caller so the tenant row is created atomically. */
  tenantId: string;
  workspaceName: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  /**
   * Password chosen during workspace creation. Seed callers may omit it; the
   * provisioner then stores an unguessable placeholder until the owner sets a
   * password through the verification flow.
   */
  adminPassword?: string;
}

export interface ProvisionTenantResult {
  tenant: Tenant;
  adminUserId: string;
  /** Raw token for the caller to email. Only its SHA-256 hash is stored. */
  verificationToken: string;
}

/**
 * Creates everything a workspace needs to be usable on day one:
 * the tenant, its system departments, the four system roles, the module
 * catalogue, role permissions, and exactly one Tenant Admin user.
 *
 * The caller supplies the transaction so provisioning participates in the
 * same atomic unit as workspace creation (and so seed scripts can use the
 * owner connection, which bypasses RLS).
 */
@Injectable()
export class TenantProvisioningService {
  async provisionTenantData(
    tx: Prisma.TransactionClient,
    params: ProvisionTenantParams,
  ): Promise<ProvisionTenantResult> {
    const tenantId = params.tenantId;
    const slug = normalizeSlug(params.slug);
    const workspaceName = params.workspaceName.trim();
    const ownerName = params.ownerName.trim();
    const ownerEmail = normalizeEmail(params.ownerEmail);

    if (!tenantId || !slug || !workspaceName || !ownerName || !ownerEmail) {
      throw new Error('Tenant provisioning requires id, slug, name, and owner.');
    }

    const permissions = await tx.permission.findMany({
      where: { type: { in: PERMISSION_TYPES } },
    });
    const permissionByType = new Map(
      permissions.map((permission) => [permission.type, permission.id]),
    );

    const missingPermissions = PERMISSION_TYPES.filter(
      (type) => !permissionByType.has(type),
    );
    if (missingPermissions.length > 0) {
      throw new Error(
        `Permission catalogue is missing: ${missingPermissions.join(', ')}. ` +
          'Run the base seed before provisioning a workspace.',
      );
    }

    const trialDays = resolveTrialDays();
    const tenant = await tx.tenant.create({
      data: {
        id: tenantId,
        name: workspaceName,
        slug,
        status: TenantStatus.TRIAL,
        trialExpiresAt: new Date(Date.now() + trialDays * DAY_MS),
        ownerEmail,
        ownerName,
        seatCount: 1,
      },
    });

    await tx.department.createMany({
      data: DEFAULT_DEPARTMENTS.map((department) => ({
        tenantId,
        key: department.key,
        name: department.name,
        sortOrder: department.sortOrder,
        isSystem: true,
      })),
      skipDuplicates: true,
    });

    const departments = await tx.department.findMany({
      where: { tenantId },
      select: { id: true, key: true },
    });
    const departmentIdByKey = new Map(
      departments.map((department) => [department.key, department.id]),
    );

    await tx.role.createMany({
      data: DEFAULT_ROLES.map((role) => ({
        tenantId,
        slug: role.slug,
        name: role.name,
        description: role.description,
        rank: role.rank,
        dataScope: role.dataScope,
        isSystem: role.isSystem,
        isTenantAdmin: role.isTenantAdmin,
      })),
      skipDuplicates: true,
    });

    const roles = await tx.role.findMany({
      where: { tenantId },
      select: { id: true, slug: true, isTenantAdmin: true },
    });
    const roleIdBySlug = new Map(roles.map((role) => [role.slug, role.id]));
    const tenantAdminRole = roles.find((role) => role.isTenantAdmin);

    if (!tenantAdminRole) {
      throw new Error('Tenant provisioning did not create a Tenant Admin role.');
    }

    await tx.module.createMany({
      data: DEFAULT_MODULES.map((module) => {
        const departmentId = module.departmentKey
          ? departmentIdByKey.get(module.departmentKey)
          : null;

        if (module.departmentKey && !departmentId) {
          throw new Error(
            `Module "${module.key}" references unknown department "${module.departmentKey}".`,
          );
        }

        return {
          tenantId,
          key: module.key,
          name: module.name,
          path: module.path,
          icon: module.icon ?? null,
          group: module.group,
          order: module.order,
          isNavigable: module.isNavigable,
          departmentId,
        };
      }),
      skipDuplicates: true,
    });

    const createdModules = await tx.module.findMany({
      where: { tenantId },
      select: { id: true, key: true },
    });
    const moduleIdByKey = new Map(
      createdModules.map((module) => [module.key, module.id]),
    );

    const grants: Prisma.RoleModulePermissionCreateManyInput[] = [];
    const seenGrants = new Set<string>();

    for (const module of DEFAULT_MODULES) {
      const moduleId = moduleIdByKey.get(module.key);
      if (!moduleId) {
        throw new Error(
          `Module "${module.key}" was not created during provisioning.`,
        );
      }

      for (const roleSlug of Object.keys(
        module.defaultPermissions,
      ) as RoleSlug[]) {
        const roleId = roleIdBySlug.get(roleSlug);
        if (!roleId) {
          throw new Error(
            `Role "${roleSlug}" was not created during provisioning.`,
          );
        }

        for (const permissionType of module.defaultPermissions[roleSlug]) {
          const permissionId = permissionByType.get(permissionType);
          if (!permissionId) {
            throw new Error(
              `Permission "${permissionType}" is missing from the catalogue.`,
            );
          }

          const grantKey = `${roleId}:${moduleId}:${permissionId}`;
          if (seenGrants.has(grantKey)) {
            continue;
          }
          seenGrants.add(grantKey);

          grants.push({
            tenantId,
            roleId,
            moduleId,
            permissionId,
          });
        }
      }
    }

    await tx.roleModulePermission.createMany({
      data: grants,
      skipDuplicates: true,
    });

    const verificationToken = randomBytes(32).toString('hex');
    const password =
      params.adminPassword && params.adminPassword.length > 0
        ? params.adminPassword
        : randomBytes(32).toString('hex');

    const adminUser = await tx.user.create({
      data: {
        tenantId,
        email: ownerEmail,
        name: ownerName,
        password: await bcrypt.hash(password, 10),
        roleId: tenantAdminRole.id,
        isVerified: false,
        verifyTokenHash: hashToken(verificationToken),
        verifyExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
      },
      select: { id: true },
    });

    return {
      tenant,
      adminUserId: adminUser.id,
      verificationToken,
    };
  }
}

export function hashVerificationToken(token: string): string {
  return hashToken(token);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveTrialDays(): number {
  const configured = Number.parseInt(
    process.env.WORKSPACE_TRIAL_DAYS ?? '',
    10,
  );

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TRIAL_DAYS;
}
