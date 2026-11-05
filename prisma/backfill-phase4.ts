// prisma/backfill-phase4.ts
//
// Idempotent backfill for the Phase 4 platform changes.
//
// Prisma migrations create the new columns and tables with safe defaults.
// This script makes the existing tenant data match the Phase 4 defaults:
//
//   * system role inheritance (department_head -> team_lead -> staff)
//   * role-level revoke effect normalisation (only with --normalize-effects)
//   * Staff/Team Lead CREATE + EDIT on department modules (never DELETE)
//   * Staff VIEW + CREATE on the leave workflow module
//   * the `attendance-leave-management` module becomes a WORKFLOW module
//   * the Tenant-Admin-only `audit-log` module exists
//   * `Notification.readAt` is backfilled from `read = true`
//
// It deliberately does not create notification preferences: Stage 5 creates
// them lazily on first read, which keeps this script free of the final
// notification-type catalogue. The ACL cache bump also lands with the Stage 4
// cache service, because no ACL cache exists yet in Stage 1.
//
// Usage:
//   npm run db:backfill:phase4 -- --dry-run
//   npm run db:backfill:phase4
//   npm run db:backfill:phase4 -- --tenant <id-or-slug>
//   npm run db:backfill:phase4 -- --all
//
// The script uses the owner connection (DIRECT_URL) because it touches every
// tenant. Each tenant's writes still run inside a transaction with
// `app.current_tenant` set so the same code works against a non-owner role and
// keeps the RLS contract explicit.
import 'dotenv/config';
import {
  ModuleType,
  PermissionEffect,
  PermissionType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const ROLE_PARENTS: Record<string, string> = {
  department_head: 'team_lead',
  team_lead: 'staff',
};

const LEAVE_MODULE_KEY = 'attendance-leave-management';
const AUDIT_MODULE_KEY = 'audit-log';

const LEAVE_MODULE_CONFIG = {
  version: 1,
  workflow: 'leave-approval',
  stages: [
    { value: 'PENDING_TEAM_LEAD', label: 'Team Lead review' },
    { value: 'PENDING_HR', label: 'HR review' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ],
  requesterFields: ['type', 'startDate', 'endDate', 'reason'],
  allowCancel: true,
};

const AUDIT_MODULE = {
  name: 'Audit Log',
  path: '/audit-log',
  group: 'Administration',
  order: 950,
  isNavigable: true,
  type: ModuleType.DATA_TABLE,
  targetEntity: 'audit_logs',
  config: { version: 1 },
};

export interface TenantBackfillSummary {
  tenantId: string;
  tenantName: string;
  roleParentsLinked: number;
  nonGrantEffects: number;
  effectsNormalised: number;
  grantsCreated: number;
  leaveModuleUpdated: boolean;
  auditModuleCreated: boolean;
  auditAccessTrimmed: number;
  notificationsBackfilled: number;
}

export interface BackfillPhase4Result {
  tenants: TenantBackfillSummary[];
}

export interface BackfillPhase4Options {
  dryRun?: boolean;
  tenant?: string;
  normalizeEffects?: boolean;
}

interface TenantRecord {
  id: string;
  name: string;
  slug: string;
}

interface RoleRecord {
  id: string;
  slug: string;
  isTenantAdmin: boolean;
  parentRoleId: string | null;
}

interface ModuleRecord {
  id: string;
  key: string;
  departmentId: string | null;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
    },
  });
}

/**
 * Key-order-insensitive JSON string, so a jsonb round-trip does not look like
 * a config change and make the backfill non-idempotent.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function backfillTenant(
  prisma: PrismaClient,
  tenant: TenantRecord,
  permissionIds: Map<PermissionType, number>,
  options: Required<Pick<BackfillPhase4Options, 'dryRun' | 'normalizeEffects'>>,
): Promise<TenantBackfillSummary> {
  const { dryRun, normalizeEffects } = options;

  const summary: TenantBackfillSummary = {
    tenantId: tenant.id,
    tenantName: tenant.name,
    roleParentsLinked: 0,
    nonGrantEffects: 0,
    effectsNormalised: 0,
    grantsCreated: 0,
    leaveModuleUpdated: false,
    auditModuleCreated: false,
    auditAccessTrimmed: 0,
    notificationsBackfilled: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant', $1, true)`,
        tenant.id,
      );

      const roles: RoleRecord[] = await tx.role.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          slug: true,
          isTenantAdmin: true,
          parentRoleId: true,
        },
      });
      const roleBySlug = new Map(roles.map((role) => [role.slug, role]));

      // 1. Role inheritance --------------------------------------------------
      for (const [childSlug, parentSlug] of Object.entries(ROLE_PARENTS)) {
        const child = roleBySlug.get(childSlug);
        const parent = roleBySlug.get(parentSlug);
        if (!child || !parent) continue;
        if (child.parentRoleId === parent.id) continue;

        summary.roleParentsLinked += 1;
        if (!dryRun) {
          await tx.role.update({
            where: { id: child.id },
            data: { parentRoleId: parent.id },
          });
        }
      }

      // 2. Revoke-effect normalisation --------------------------------------
      // Existing rows received GRANT from the migration default. Re-running
      // this script must not silently turn a deliberate REVOKE back into a
      // GRANT, so the destructive reset is opt-in.
      summary.nonGrantEffects = await tx.roleModulePermission.count({
        where: {
          tenantId: tenant.id,
          effect: { not: PermissionEffect.GRANT },
        },
      });
      if (normalizeEffects && summary.nonGrantEffects > 0) {
        summary.effectsNormalised = summary.nonGrantEffects;
        if (!dryRun) {
          await tx.roleModulePermission.updateMany({
            where: {
              tenantId: tenant.id,
              effect: { not: PermissionEffect.GRANT },
            },
            data: { effect: PermissionEffect.GRANT },
          });
        }
      }

      // 3. Leave workflow module -------------------------------------------
      let leaveModule = await tx.module.findUnique({
        where: { tenantId_key: { tenantId: tenant.id, key: LEAVE_MODULE_KEY } },
        select: { id: true, key: true, departmentId: true },
      });

      if (leaveModule) {
        const currentLeaveModule = await tx.module.findUnique({
          where: { id: leaveModule.id },
          select: { type: true, targetEntity: true, config: true },
        });
        const changed =
          currentLeaveModule?.type !== ModuleType.WORKFLOW ||
          currentLeaveModule?.targetEntity !== 'leave_requests' ||
          canonicalJson(currentLeaveModule?.config) !==
            canonicalJson(LEAVE_MODULE_CONFIG);
        if (changed) {
          summary.leaveModuleUpdated = true;
          if (!dryRun) {
            await tx.module.update({
              where: { id: leaveModule.id },
              data: {
                type: ModuleType.WORKFLOW,
                targetEntity: 'leave_requests',
                config: LEAVE_MODULE_CONFIG,
                isNavigable: true,
              },
            });
          }
        }
      } else {
        summary.leaveModuleUpdated = true;
        if (!dryRun) {
          const hrDepartment = await tx.department.findFirst({
            where: { tenantId: tenant.id, key: 'human_resources' },
            select: { id: true },
          });
          leaveModule = await tx.module.create({
            data: {
              tenantId: tenant.id,
              key: LEAVE_MODULE_KEY,
              name: 'Attendance & Leave',
              path: '/hr/attendance-leave-management',
              icon: 'CalendarCheck',
              group: 'Human Resources',
              order: 51,
              isNavigable: true,
              type: ModuleType.WORKFLOW,
              targetEntity: 'leave_requests',
              config: LEAVE_MODULE_CONFIG,
              departmentId: hrDepartment?.id ?? null,
            },
            select: { id: true, key: true, departmentId: true },
          });
        }
      }

      const modules: ModuleRecord[] = await tx.module.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, key: true, departmentId: true },
      });
      const moduleByKey = new Map(modules.map((module) => [module.key, module]));

      // 4. Permission defaults ---------------------------------------------
      const existingGrants = await tx.roleModulePermission.findMany({
        where: { tenantId: tenant.id },
        select: { roleId: true, moduleId: true, permissionId: true },
      });
      const grantKeys = new Set(
        existingGrants.map(
          (grant) => `${grant.roleId}:${grant.moduleId}:${grant.permissionId}`,
        ),
      );

      const ensureGrant = async (
        roleId: string,
        moduleId: string,
        permissionType: PermissionType,
      ): Promise<void> => {
        const permissionId = permissionIds.get(permissionType);
        if (!permissionId) {
          throw new Error(
            `Permission "${permissionType}" is missing from the catalogue.`,
          );
        }
        const key = `${roleId}:${moduleId}:${permissionId}`;
        if (grantKeys.has(key)) return;
        grantKeys.add(key);
        summary.grantsCreated += 1;
        if (dryRun) return;

        await tx.roleModulePermission.create({
          data: {
            tenantId: tenant.id,
            roleId,
            moduleId,
            permissionId,
            effect: PermissionEffect.GRANT,
          },
        });
      };

      const departmentModules = modules.filter(
        (module) =>
          module.departmentId !== null && module.key !== AUDIT_MODULE_KEY,
      );

      for (const roleSlug of ['team_lead', 'staff']) {
        const role = roleBySlug.get(roleSlug);
        if (!role) continue;

        for (const module of departmentModules) {
          const isLeaveModule = module.key === LEAVE_MODULE_KEY;
          // Staff do not get direct EDIT on the leave workflow; transitions go
          // through the state-machine endpoints.
          if (roleSlug === 'staff' && isLeaveModule) continue;

          const hasView = grantKeys.has(
            `${role.id}:${module.id}:${permissionIds.get(PermissionType.VIEW)}`,
          );
          if (!hasView) continue;

          await ensureGrant(role.id, module.id, PermissionType.CREATE);
          await ensureGrant(role.id, module.id, PermissionType.EDIT);
        }
      }

      // Staff can submit leave (VIEW + CREATE) without editing workflow state.
      const staffRole = roleBySlug.get('staff');
      const leaveModuleId = leaveModule?.id ?? moduleByKey.get(LEAVE_MODULE_KEY)?.id;
      if (staffRole && leaveModuleId) {
        await ensureGrant(staffRole.id, leaveModuleId, PermissionType.VIEW);
        await ensureGrant(staffRole.id, leaveModuleId, PermissionType.CREATE);
      }

      // 5. Audit log module --------------------------------------------------
      const tenantAdminRole = roles.find((role) => role.isTenantAdmin);
      let auditModule = moduleByKey.get(AUDIT_MODULE_KEY);
      if (!auditModule) {
        summary.auditModuleCreated = true;
        if (!dryRun) {
          auditModule = await tx.module.create({
            data: {
              tenantId: tenant.id,
              key: AUDIT_MODULE_KEY,
              ...AUDIT_MODULE,
            },
            select: { id: true, key: true, departmentId: true },
          });
          moduleByKey.set(auditModule.key, auditModule);
        } else if (tenantAdminRole) {
          // The Tenant Admin VIEW grant cannot be probed without a module id.
          summary.grantsCreated += 1;
        }
      }

      if (auditModule && tenantAdminRole) {
        await ensureGrant(
          tenantAdminRole.id,
          auditModule.id,
          PermissionType.VIEW,
        );

        // Enforce "Tenant Admin only": drop grants held by any other role.
        const nonAdminRoleIds = roles
          .filter((role) => !role.isTenantAdmin)
          .map((role) => role.id);
        if (nonAdminRoleIds.length > 0) {
          const foreignAuditGrants = await tx.roleModulePermission.count({
            where: {
              tenantId: tenant.id,
              moduleId: auditModule.id,
              roleId: { in: nonAdminRoleIds },
            },
          });
          summary.auditAccessTrimmed = foreignAuditGrants;
          if (foreignAuditGrants > 0 && !dryRun) {
            await tx.roleModulePermission.deleteMany({
              where: {
                tenantId: tenant.id,
                moduleId: auditModule.id,
                roleId: { in: nonAdminRoleIds },
              },
            });
          }
        }
      }

      // 6. Notification read timestamps -------------------------------------
      const unreadTimestamped = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count
           FROM "Notification"
          WHERE "tenantId" = $1
            AND "read" = true
            AND "readAt" IS NULL`,
        tenant.id,
      );
      summary.notificationsBackfilled = Number(unreadTimestamped[0]?.count ?? 0);
      if (summary.notificationsBackfilled > 0 && !dryRun) {
        await tx.$executeRawUnsafe(
          `UPDATE "Notification"
              SET "readAt" = "createdAt"
            WHERE "tenantId" = $1
              AND "read" = true
              AND "readAt" IS NULL`,
          tenant.id,
        );
      }
    },
    // Large workspaces can have many modules and grants.
    { timeout: 300_000, maxWait: 15_000 },
  );

  return summary;
}

export async function backfillPhase4(
  prisma: PrismaClient,
  options: BackfillPhase4Options = {},
): Promise<BackfillPhase4Result> {
  const dryRun = options.dryRun === true;
  const normalizeEffects = options.normalizeEffects === true;

  const tenantWhere: Prisma.TenantWhereInput = options.tenant
    ? { OR: [{ id: options.tenant }, { slug: options.tenant }] }
    : {};

  const tenants: TenantRecord[] = await prisma.tenant.findMany({
    where: tenantWhere,
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  if (tenants.length === 0) {
    throw new Error(
      options.tenant
        ? `Tenant "${options.tenant}" was not found.`
        : 'No tenants found.',
    );
  }

  const permissions = await prisma.permission.findMany({
    where: { type: { in: Object.values(PermissionType) } },
    select: { id: true, type: true },
  });
  const permissionIds = new Map(
    permissions.map((permission) => [permission.type, permission.id]),
  );

  const summaries: TenantBackfillSummary[] = [];
  for (const tenant of tenants) {
    summaries.push(
      await backfillTenant(prisma, tenant, permissionIds, {
        dryRun,
        normalizeEffects,
      }),
    );
  }

  return { tenants: summaries };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const normalizeEffects = args.includes('--normalize-effects');
  const tenantIndex = args.indexOf('--tenant');
  const tenant =
    tenantIndex >= 0 && args[tenantIndex + 1] ? args[tenantIndex + 1] : undefined;

  const prisma = createPrismaClient();

  try {
    const result = await backfillPhase4(prisma, {
      dryRun,
      tenant,
      normalizeEffects,
    });

    for (const summary of result.tenants) {
      console.log(
        `${dryRun ? '[dry-run] ' : ''}${summary.tenantName} (${summary.tenantId})`,
      );
      console.log(
        `  role parents linked: ${summary.roleParentsLinked}` +
          ` | grants created: ${summary.grantsCreated}` +
          ` | leave module updated: ${summary.leaveModuleUpdated}` +
          ` | audit module created: ${summary.auditModuleCreated}` +
          ` | audit grants trimmed: ${summary.auditAccessTrimmed}` +
          ` | notifications timestamped: ${summary.notificationsBackfilled}`,
      );
      if (summary.nonGrantEffects > 0) {
        console.log(
          `  role-level revokes found: ${summary.nonGrantEffects}` +
            (normalizeEffects
              ? ` (normalised: ${summary.effectsNormalised})`
              : ' (preserved; pass --normalize-effects to reset)'),
        );
      }
    }

    const totals = result.tenants.reduce(
      (acc, summary) => ({
        tenants: acc.tenants + 1,
        grants: acc.grants + summary.grantsCreated,
        notifications: acc.notifications + summary.notificationsBackfilled,
      }),
      { tenants: 0, grants: 0, notifications: 0 },
    );
    console.log(
      `${dryRun ? 'Dry run' : 'Backfill'} complete: ` +
        `${totals.tenants} tenants, ${totals.grants} grants created, ` +
        `${totals.notifications} notification timestamps backfilled.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Phase 4 backfill failed:', error);
    process.exitCode = 1;
  });
}
