// prisma/seed.ts
//
// Tenant-aware seed.
//
// Connects with the migration/admin connection (DIRECT_URL / owner role) because
// it creates the initial tenant and the global permission catalogue that must
// exist before any tenant context can be resolved. The owner role bypasses RLS,
// which is required for creating the very first tenant row.
//
// Idempotent and batched: uses createMany + skipDuplicates to minimise the
// number of round-trips to the database.
import { PrismaClient, Role, PermissionType, DepartmentType } from '@prisma/client';
import { ALL_ROUTES } from '../src/auth/routes';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  },
});

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME ?? 'Default Tenant';

const DEPARTMENT_TYPES: DepartmentType[] = [
  DepartmentType.ADMINISTRATION,
  DepartmentType.HUMAN_RESOURCES,
  DepartmentType.SALES,
  DepartmentType.OPERATIONS,
  DepartmentType.FINANCE,
  DepartmentType.INFORMATION_TECHNOLOGY,
  DepartmentType.CUSTOMER_SERVICE,
  DepartmentType.ACCOUNTING,
];

const ALL_ROLES: Role[] = [Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF];

const ALL_PERMISSIONS: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
  PermissionType.DELETE,
];

function titleCase(enumValue: string): string {
  return enumValue
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

async function main() {
  // 1. Default tenant ----------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: { name: DEFAULT_TENANT_NAME },
    create: { name: DEFAULT_TENANT_NAME, slug: DEFAULT_TENANT_SLUG },
  });
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Global permission catalogue (not tenant-scoped) -------------------------
  await prisma.permission.createMany({
    data: ALL_PERMISSIONS.map((type) => ({ type })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany();
  const permIdByType = new Map(permissions.map((p) => [p.type, p.id] as const));
  for (const type of ALL_PERMISSIONS) {
    if (permIdByType.get(type) === undefined) {
      throw new Error(`Failed to seed permission: ${type}`);
    }
  }

  // 3. Departments for the tenant (one batched insert) -------------------------
  await prisma.department.createMany({
    data: DEPARTMENT_TYPES.map((type) => ({
      tenantId: tenant.id,
      type,
      name: titleCase(type),
    })),
    skipDuplicates: true,
  });

  const departments = await prisma.department.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, type: true },
  });
  const departmentIdByType = new Map(
    departments.map((d) => [d.type, d.id] as const),
  );
  console.log(`Departments seeded: ${departments.length}`);

  // 4. Modules for the tenant (one batched insert) -----------------------------
  await prisma.module.createMany({
    data: ALL_ROUTES.map((route) => {
      let departmentId: string | undefined;
      if (route.department) {
        const deptType = (
          Array.isArray(route.department) ? route.department[0] : route.department
        ) as unknown as DepartmentType;
        departmentId = departmentIdByType.get(deptType);
      }
      return {
        tenantId: tenant.id,
        name: route.name,
        path: route.path,
        icon: route.icon ?? null,
        departmentId: departmentId ?? null,
      };
    }),
    skipDuplicates: true,
  });

  const modules = await prisma.module.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, path: true },
  });
  const moduleIdByPath = new Map(modules.map((m) => [m.path, m.id] as const));
  console.log(`Modules seeded: ${modules.length}`);

  // 5. Role -> module -> permission grants (one batched insert) ----------------
  const roleModulePermissions: {
    role: Role;
    moduleId: string;
    permissionId: number;
  }[] = [];

  for (const route of ALL_ROUTES) {
    const moduleId = moduleIdByPath.get(route.path);
    if (!moduleId) continue;

    for (const role of ALL_ROLES) {
      const granted = route.permissions[role] ?? [];
      for (const permission of granted) {
        const permissionId = permIdByType.get(
          permission as unknown as PermissionType,
        );
        if (permissionId === undefined) continue;
        roleModulePermissions.push({ role, moduleId, permissionId });
      }
    }
  }

  await prisma.roleModulePermission.createMany({
    data: roleModulePermissions,
    skipDuplicates: true,
  });
  console.log(`Role/module permissions seeded: ${roleModulePermissions.length}`);

  console.log('Seeding complete.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect().catch(() => undefined);
  });
