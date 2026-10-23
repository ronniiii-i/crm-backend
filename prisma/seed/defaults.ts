import { PrismaClient } from '@prisma/client';
import { PERMISSION_TYPES } from '../../src/tenant/defaults';

/**
 * Seed-facing entry point for the workspace defaults.
 *
 * The canonical catalogue lives in `src/tenant/defaults.ts` so tenant
 * provisioning can import it without crossing the backend's build root.
 */
export * from '../../src/tenant/defaults';

/**
 * Ensures the four global permission types exist. The runtime role has
 * SELECT-only access to this table, so this runs only under the owner
 * connection during seeding.
 */
export async function ensurePermissionCatalogue(
  prisma: PrismaClient,
): Promise<void> {
  for (const type of PERMISSION_TYPES) {
    await prisma.permission.upsert({
      where: { type },
      update: {},
      create: { type },
    });
  }

  const permissions = await prisma.permission.findMany({
    where: { type: { in: PERMISSION_TYPES } },
    select: { type: true },
  });

  if (permissions.length !== PERMISSION_TYPES.length) {
    throw new Error('Failed to seed the global permission catalogue.');
  }
}
