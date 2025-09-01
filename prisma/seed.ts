// prisma/seed.ts

import {
  PrismaClient,
  DepartmentType,
  Role,
  PermissionType,
} from '@prisma/client';
import { ALL_ROUTES } from '../src/auth/routes';
import { Department } from '../src/auth/permission-types';

const prisma = new PrismaClient();

// Create a mapping from your routes.ts enum to your Prisma enum
const departmentMapping: Record<Department, DepartmentType> = {
  [Department.FINANCE]: DepartmentType.FINANCE,
  [Department.IT]: DepartmentType.INFORMATION_TECHNOLOGY,
  [Department.SALES]: DepartmentType.SALES,
  [Department.CUSTOMER_SUPPORT]: DepartmentType.CUSTOMER_SERVICE,
  [Department.HR]: DepartmentType.HUMAN_RESOURCES,
  [Department.ACCOUNTING]: DepartmentType.FINANCE, // Assuming Accounting falls under Finance
  [Department.ADMINISTRATION]: DepartmentType.ADMINISTRATION,
  [Department.OPERATIONS]: DepartmentType.OPERATIONS,
};

async function main() {
  console.log('Start seeding...');

  // Seed Permissions
  const permissionsData = [
    { type: PermissionType.VIEW },
    { type: PermissionType.EDIT },
    { type: PermissionType.DELETE },
  ];
  await prisma.permission.createMany({
    data: permissionsData,
    skipDuplicates: true,
  });

  const viewPerm = await prisma.permission.findUnique({
    where: { type: PermissionType.VIEW },
  });
  const editPerm = await prisma.permission.findUnique({
    where: { type: PermissionType.EDIT },
  });
  const deletePerm = await prisma.permission.findUnique({
    where: { type: PermissionType.DELETE },
  });

  if (!viewPerm || !editPerm || !deletePerm) {
    throw new Error('Could not find all required permissions in the database.');
  }

  console.log('Permissions seeded.');

  // Seed Modules and RoleModulePermissions
  for (const route of ALL_ROUTES) {
    let departmentId: string | undefined;

    if (route.department) {
      // Find the correct Prisma enum value using the mapping
      const prismaDepartmentType = Array.isArray(route.department)
        ? departmentMapping[route.department[0]]
        : departmentMapping[route.department];

      if (prismaDepartmentType) {
        const department = await prisma.department.findUnique({
          where: { type: prismaDepartmentType },
        });
        departmentId = department?.id;
      }
    }

    const module = await prisma.module.upsert({
      where: { path: route.path },
      update: {},
      create: {
        id: route.id,
        name: route.name,
        path: route.path,
        icon: route.icon,
        departmentId: departmentId,
      },
    });

    for (const role in route.permissions) {
      const allowedPermissions = route.permissions[role as Role];

      for (const permission of allowedPermissions) {
        let permissionId;
        if (permission === 'VIEW') permissionId = viewPerm.id;
        if (permission === 'EDIT') permissionId = editPerm.id;
        if (permission === 'DELETE') permissionId = deletePerm.id;

        if (permissionId) {
          await prisma.roleModulePermission.upsert({
            where: {
              role_moduleId_permissionId: {
                role: role as Role,
                moduleId: module.id,
                permissionId: permissionId,
              },
            },
            update: {},
            create: {
              role: role as Role,
              moduleId: module.id,
              permissionId: permissionId,
            },
          });
        }
      }
    }
  }
  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
