// prisma/seed.ts
import {
  PrismaClient,
  DepartmentType,
  Role,
  PermissionType,
} from '@prisma/client';
import { ALL_ROUTES } from '../src/auth/routes';

const prisma = new PrismaClient();

async function main() {
  // Seed Permissions (idempotent)
  await prisma.permission.createMany({
    data: [
      { type: PermissionType.VIEW },
      { type: PermissionType.EDIT },
      { type: PermissionType.DELETE },
    ],
    skipDuplicates: true,
  });

  const [viewPerm, editPerm, deletePerm] = await Promise.all([
    prisma.permission.findUnique({ where: { type: PermissionType.VIEW } }),
    prisma.permission.findUnique({ where: { type: PermissionType.EDIT } }),
    prisma.permission.findUnique({ where: { type: PermissionType.DELETE } }),
  ]);

  if (!viewPerm || !editPerm || !deletePerm) {
    throw new Error('Could not find required permissions in the database.');
  }

  // permMap stores numeric IDs (Int primary key in schema)
  const permMap: Record<string, number> = {
    VIEW: viewPerm.id,
    EDIT: editPerm.id,
    DELETE: deletePerm.id,
  };

  // Seed Modules and RoleModulePermissions
  for (const route of ALL_ROUTES) {
    let departmentId: string | undefined;

    if (route.department) {
      const deptType = Array.isArray(route.department)
        ? (route.department[0] as unknown as DepartmentType)
        : (route.department as unknown as DepartmentType);

      const dept = await prisma.department.findUnique({
        where: { type: deptType },
      });
      departmentId = dept?.id;
    }

    const mod = await prisma.module.upsert({
      where: { path: route.path },
      update: { name: route.name, icon: route.icon },
      create: {
        id: route.id,
        name: route.name,
        path: route.path,
        icon: route.icon,
        departmentId,
      },
    });

    for (const role in route.permissions) {
      const allowedPermissions = route.permissions[role as Role];
      for (const permission of allowedPermissions) {
        const permissionId = permMap[permission];
        if (permissionId === undefined) continue;

        await prisma.roleModulePermission.upsert({
          where: {
            role_moduleId_permissionId: {
              role: role as Role,
              moduleId: mod.id,
              permissionId,
            },
          },
          update: {},
          create: { role: role as Role, moduleId: mod.id, permissionId },
        });
      }
    }
  }

  console.log('Seeding complete: ' + ALL_ROUTES.length + ' routes processed.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect().catch(() => undefined);
  });
