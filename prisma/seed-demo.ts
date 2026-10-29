// prisma/seed-demo.ts
//
// Lean Phase 2 demo data.
//
// Provisions two fully isolated tenants (`acme` and `beta`) so subdomain
// routing, tenant-scoped login, and permission isolation can be exercised
// locally. Each tenant gets four named users covering the four system roles.
//
// Idempotent: tenants that already exist are left untouched, so rerunning the
// seed never duplicates roles, modules, grants, or users.
//
// Usage:
//   npm run db:seed:demo
//   SEED_DEMO=true npm run db:seed
import 'dotenv/config';
import { EmploymentStatus, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { TenantProvisioningService } from '../src/tenant/tenant-provisioning.service';
import { ensurePermissionCatalogue, RoleSlug } from './seed/defaults';

const DEMO_PASSWORD = 'Password123!';
const provisioning = new TenantProvisioningService();

interface DemoUserSpec {
  email: string;
  name: string;
  roleSlug: RoleSlug;
  departmentKey: string;
}

interface DemoTenantSpec {
  slug: string;
  name: string;
  ownerEmail: string;
  ownerName: string;
  users: DemoUserSpec[];
}

const DEMO_TENANTS: DemoTenantSpec[] = [
  {
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'admin@acme.test',
    ownerName: 'Acme Admin',
    users: [
      {
        email: 'finance.hod@acme.test',
        name: 'Finley Hart',
        roleSlug: 'department_head',
        departmentKey: 'finance',
      },
      {
        email: 'sales.lead@acme.test',
        name: 'Skyler Lane',
        roleSlug: 'team_lead',
        departmentKey: 'sales',
      },
      {
        email: 'staff@acme.test',
        name: 'Sam Reed',
        roleSlug: 'staff',
        departmentKey: 'sales',
      },
    ],
  },
  {
    slug: 'beta',
    name: 'Beta',
    ownerEmail: 'admin@beta.test',
    ownerName: 'Beta Admin',
    users: [
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
    ],
  },
];

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  await ensurePermissionCatalogue(prisma);

  for (const tenantSpec of DEMO_TENANTS) {
    const existing = await prisma.tenant.findUnique({
      where: { slug: tenantSpec.slug },
      select: { id: true },
    });

    if (existing) {
      console.log(`Demo tenant "${tenantSpec.slug}" already exists; skipped.`);
      continue;
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const tenantId = randomUUID();

    await prisma.$transaction(
      async (tx) => {
        await provisioning.provisionTenantData(tx, {
          tenantId,
          workspaceName: tenantSpec.name,
          slug: tenantSpec.slug,
          ownerEmail: tenantSpec.ownerEmail,
          ownerName: tenantSpec.ownerName,
          adminPassword: DEMO_PASSWORD,
        });
      },
      { maxWait: 15000, timeout: 90000 },
    );

    await prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
        });

        await tx.user.updateMany({
          where: { tenantId: tenant.id, email: tenantSpec.ownerEmail },
          data: {
            password: passwordHash,
            name: tenantSpec.ownerName,
            isVerified: true,
            verifyTokenHash: null,
            verifyExpiresAt: null,
          },
        });

        const departments = await tx.department.findMany({
          where: { tenantId: tenant.id },
          select: { id: true, key: true },
        });
        const departmentIdByKey = new Map(
          departments.map((department) => [department.key, department.id]),
        );

        const roles = await tx.role.findMany({
          where: { tenantId: tenant.id },
          select: { id: true, slug: true },
        });
        const roleIdBySlug = new Map(roles.map((role) => [role.slug, role.id]));

        const users = tenantSpec.users.map((user) => {
          const roleId = roleIdBySlug.get(user.roleSlug);
          const departmentId = departmentIdByKey.get(user.departmentKey);

          if (!roleId) {
            throw new Error(
              `Demo role "${user.roleSlug}" missing for tenant "${tenantSpec.slug}".`,
            );
          }
          if (!departmentId) {
            throw new Error(
              `Demo department "${user.departmentKey}" missing for tenant "${tenantSpec.slug}".`,
            );
          }

          return {
            tenantId: tenant.id,
            email: user.email,
            name: user.name,
            password: passwordHash,
            roleId,
            departmentId,
            status: EmploymentStatus.ACTIVE,
            isVerified: true,
          };
        });

        await tx.user.createMany({ data: users });

        await tx.tenant.update({
          where: { id: tenant.id },
          data: { seatCount: users.length + 1 },
        });
      },
      { maxWait: 15000, timeout: 60000 },
    );

    console.log(
      `Demo tenant "${tenantSpec.slug}" ready ` +
        `(${tenantSpec.users.length + 1} users).`,
    );
  }
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
    },
  });
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  try {
    await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Demo seed failed:', error);
    process.exitCode = 1;
  });
}
