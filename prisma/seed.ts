// prisma/seed.ts
//
// Base seed for a fresh Phase 2 database.
//
// Seeds the global permission catalogue and (optionally) the isolated system
// administrator. Tenants are provisioned through TenantProvisioningService so
// every workspace receives the same roles, departments, modules, permissions,
// and single Tenant Admin user.
//
// This script uses the owner connection because it writes global rows before
// any tenant context exists. The owner role bypasses RLS; the runtime
// `crm_app` role never runs this code.
import 'dotenv/config';
import { PrismaClient, SystemAdminRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ensurePermissionCatalogue } from './seed/defaults';
import { seedDemo } from './seed-demo';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  },
});

async function seedSystemAdmin(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log(
      'Skipping system admin seed (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set).',
    );
    return;
  }

  const name = process.env.SUPER_ADMIN_NAME?.trim() || 'System Admin';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.systemAdmin.upsert({
    where: { email },
    update: {
      name,
      password: passwordHash,
      role: SystemAdminRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      email,
      name,
      password: passwordHash,
      role: SystemAdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log(`System admin ready: ${email}`);
}

async function main(): Promise<void> {
  await ensurePermissionCatalogue(prisma);
  console.log('Global permission catalogue is ready.');

  await seedSystemAdmin();

  if (process.env.SEED_DEMO === 'true') {
    await seedDemo(prisma);
  }
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('Base seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
