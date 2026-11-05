import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  DEMO_TEMPLATE,
  WorkspaceTemplateKey,
} from '../../../src/tenant/templates';
import { ensurePermissionCatalogue } from '../defaults';
import { seedAcme } from './acme';
import { seedCleanSlate } from './clean-slate';
import {
  ensureProvisionedTenant,
  ensureTemplateStructure,
  refreshTenantSeatCount,
  upsertSeedUser,
} from './structure';

/**
 * Seed entry points for the two Phase 3 workspaces.
 *
 * - Acme Corp: rich demo records for screenshots and manual QA.
 * - Clean Slate Inc: production-shaped workspace with zero business records.
 * - Beta: legacy lean workspace for pre-Phase-3 Playwright tests, gated by
 *   `SEED_LEGACY_BETA` (default true outside production, false in production).
 */

export const DEMO_PASSWORD = 'Password123!';

const LEGACY_BETA = {
  slug: 'beta',
  name: 'Beta',
  ownerEmail: 'admin@beta.test',
  ownerName: 'Beta Admin',
  template: WorkspaceTemplateKey.DEMO,
} as const;

const LEGACY_BETA_USERS = [
  {
    email: 'finance.hod@beta.test',
    name: 'Frankie Holt',
    roleSlug: 'department_head',
    departmentKey: 'finance',
  },
  {
    email: 'sales.lead@beta.test',
    name: 'Bailey Cole',
    roleSlug: 'team_lead',
    departmentKey: 'sales',
  },
  {
    email: 'staff@beta.test',
    name: 'Blake Moss',
    roleSlug: 'staff',
    departmentKey: 'sales',
  },
];

export function isLegacyBetaEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = env.SEED_LEGACY_BETA?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return env.NODE_ENV !== 'production';
}

async function seedLegacyBeta(
  prisma: PrismaClient,
  passwordHash: string,
): Promise<void> {
  const seatCount = await prisma.$transaction(
    async (tx) => {
      const tenantId = await ensureProvisionedTenant(tx, LEGACY_BETA);
      const structure = await ensureTemplateStructure(
        tx,
        tenantId,
        DEMO_TEMPLATE,
      );

      const adminRoleId = structure.roleIdBySlug.get('tenant_admin');
      if (!adminRoleId) {
        throw new Error('Beta tenant is missing the Tenant Admin role.');
      }

      await upsertSeedUser(tx, {
        tenantId,
        email: LEGACY_BETA.ownerEmail,
        name: LEGACY_BETA.ownerName,
        passwordHash,
        roleId: adminRoleId,
        departmentId: null,
      });

      for (const user of LEGACY_BETA_USERS) {
        const roleId = structure.roleIdBySlug.get(user.roleSlug);
        if (!roleId) {
          throw new Error(`Beta role "${user.roleSlug}" is missing.`);
        }
        const departmentId =
          structure.departmentIdByKey.get(user.departmentKey) ?? null;
        if (!departmentId) {
          throw new Error(
            `Beta department "${user.departmentKey}" is missing.`,
          );
        }

        await upsertSeedUser(tx, {
          tenantId,
          email: user.email,
          name: user.name,
          passwordHash,
          roleId,
          departmentId,
        });
      }

      return refreshTenantSeatCount(tx, tenantId);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );

  console.log(`Legacy Beta tenant ready (${seatCount} users).`);
}

/**
 * Seeds Acme + Clean Slate, plus the legacy Beta tenant when enabled.
 *
 * The permission catalogue must exist before provisioning; this function
 * ensures it so it is safe to call directly from either seed entry point.
 */
export async function seedWorkspaces(prisma: PrismaClient): Promise<void> {
  await ensurePermissionCatalogue(prisma);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await seedAcme(prisma, passwordHash);
  await seedCleanSlate(prisma, passwordHash);

  if (isLegacyBetaEnabled()) {
    await seedLegacyBeta(prisma, passwordHash);
  } else {
    console.log('Skipping legacy Beta tenant (SEED_LEGACY_BETA=false).');
  }
}
