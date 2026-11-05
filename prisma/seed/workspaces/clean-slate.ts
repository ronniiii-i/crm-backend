import { PrismaClient } from '@prisma/client';
import {
  CLEAN_SLATE_TEMPLATE,
  WorkspaceTemplateKey,
} from '../../../src/tenant/templates';
import {
  ensureProvisionedTenant,
  ensureTemplateStructure,
  refreshTenantSeatCount,
  upsertSeedUser,
} from './structure';

/**
 * Clean Slate Inc: the production default workspace shape.
 *
 * The tenant receives every department, role, module, permission grant, and
 * renderer config, but exactly one user and zero business records. Re-running
 * the seed leaves the workspace at the same state.
 */

export const CLEAN_SLATE_TENANT = {
  slug: 'clean-slate',
  name: 'Clean Slate Inc',
  ownerEmail: 'admin@cleanslate.test',
  ownerName: 'Casey Clean',
  template: WorkspaceTemplateKey.CLEAN_SLATE,
} as const;

export async function seedCleanSlate(
  prisma: PrismaClient,
  passwordHash: string,
): Promise<void> {
  const seatCount = await prisma.$transaction(
    async (tx) => {
      const tenantId = await ensureProvisionedTenant(tx, CLEAN_SLATE_TENANT);
      const structure = await ensureTemplateStructure(
        tx,
        tenantId,
        CLEAN_SLATE_TEMPLATE,
      );

      const adminRoleId = structure.roleIdBySlug.get('tenant_admin');
      if (!adminRoleId) {
        throw new Error('Clean Slate tenant is missing the Tenant Admin role.');
      }

      await upsertSeedUser(tx, {
        tenantId,
        email: CLEAN_SLATE_TENANT.ownerEmail,
        name: CLEAN_SLATE_TENANT.ownerName,
        passwordHash,
        roleId: adminRoleId,
        departmentId: null,
      });

      return refreshTenantSeatCount(tx, tenantId);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );

  console.log(`Clean Slate Inc ready (${seatCount} user, 0 business records).`);
}
