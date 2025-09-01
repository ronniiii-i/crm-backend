// prisma/seed.ts

import { PrismaClient, DepartmentType, Role } from '@prisma/client';
import { ALL_ROUTES } from 'src/auth/routes';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // 1. Seed Permissions
  const permissionsData = [
    { type: 'VIEW' },
    { type: 'EDIT' },
    { type: 'DELETE' },
  ];
  await prisma.permission.createMany({
    data: permissionsData,
    skipDuplicates: true,
  });

  const viewPerm = await prisma.permission.findUnique({
    where: { type: 'VIEW' },
  });
  const editPerm = await prisma.permission.findUnique({
    where: { type: 'EDIT' },
  });
  const deletePerm = await prisma.permission.findUnique({
    where: { type: 'DELETE' },
  });

  console.log('Permissions seeded.');

  // 2. Seed Modules and RoleModulePermissions
  for (const route of ALL_ROUTES) {
    // Insert module data
    const module = await prisma.module.upsert({
      where: { path: route.path },
      update: {}, // No need to update on subsequent runs
      create: {
        id: route.id, // Use the existing ID from your route file
        name: route.name,
        path: route.path,
        icon: route.icon, // Assuming 'icon' is a field in your Module model
        department: route.department
          ? {
              connect: { type: route.department as DepartmentType }, // Adjust for array/single string
            }
          : undefined,
      },
    });

    // Handle department mapping (if department is an array)
    // You will need to add logic here to handle the `department: Department.HR, Department.ACCOUNTING` case from your `routes.ts` file.

    // Insert permissions for each role
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
