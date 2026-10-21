const { PrismaClient, Role, PermissionEffect } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const p = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const DEFAULT_PASSWORD = 'Password123!';
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

async function main() {
  const tenant = await p.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error('tenant not found');

  const modules = await p.module.findMany({ where: { tenantId: tenant.id } });
  const permissions = await p.permission.findMany();
  const permId = Object.fromEntries(permissions.map((x) => [x.type, x.id]));

  const byName = Object.fromEntries(modules.map((m) => [m.name, m]));
  const moduleByPath = Object.fromEntries(modules.map((m) => [m.path, m]));

  console.log('modules:', modules.length);

  // 1. Create a "Finance Power Users" permission group
  const financeModules = modules.filter((m) =>
    [
      '/finance/invoices',
      '/finance/payments',
      '/finance/expense-tracking',
      '/finance/budget-management',
      '/finance/financial-reports',
    ].includes(m.path),
  );

  let financeGroup = await p.permissionGroup.findFirst({
    where: { tenantId: tenant.id, name: 'Finance Power Users' },
  });

  if (!financeGroup) {
    financeGroup = await p.permissionGroup.create({
      data: { tenantId: tenant.id, name: 'Finance Power Users', description: 'Elevated access to finance and accounting modules' },
    });
  }

  for (const mod of financeModules) {
    for (const ptype of ['VIEW', 'CREATE', 'EDIT', 'DELETE']) {
      if (!permId[ptype]) continue;
      await p.permissionGroupItem.upsert({
        where: { groupId_moduleId_permissionId: { groupId: financeGroup.id, moduleId: mod.id, permissionId: permId[ptype] } },
        update: {},
        create: { groupId: financeGroup.id, moduleId: mod.id, permissionId: permId[ptype] },
      });
    }
  }

  // 2. Assign the group to the Finance HOD
  const finHod = await p.user.findFirst({
    where: { tenantId: tenant.id, email: 'hod.finance@claspcrm.com' },
  });
  if (finHod) {
    await p.permissionGroupAssignment.upsert({
      where: { id: `assign-${financeGroup.id}-${finHod.id}` },
      update: {},
      create: { id: `assign-${financeGroup.id}-${finHod.id}`, groupId: financeGroup.id, userId: finHod.id },
    });
    console.log('group assigned to:', finHod.email);
  }

  // 3. Create an "Auditors" group assigned to the IT department
  let auditorGroup = await p.permissionGroup.findFirst({
    where: { tenantId: tenant.id, name: 'Auditors' },
  });
  if (!auditorGroup) {
    auditorGroup = await p.permissionGroup.create({
      data: { tenantId: tenant.id, name: 'Auditors', description: 'Read-only access across tenant modules' },
    });
  }

  for (const mod of modules.filter((m) => !m.departmentId)) {
    await p.permissionGroupItem.upsert({
      where: { groupId_moduleId_permissionId: { groupId: auditorGroup.id, moduleId: mod.id, permissionId: permId['VIEW'] } },
      update: {},
      create: { groupId: auditorGroup.id, moduleId: mod.id, permissionId: permId['VIEW'] },
    });
  }

  // 3b. Auditors also get read-only access to their own department's modules
  for (const mod of modules.filter((m) => m.departmentId)) {
    await p.permissionGroupItem.upsert({
      where: { groupId_moduleId_permissionId: { groupId: auditorGroup.id, moduleId: mod.id, permissionId: permId['VIEW'] } },
      update: {},
      create: { groupId: auditorGroup.id, moduleId: mod.id, permissionId: permId['VIEW'] },
    });
  }

  const itDept = await p.department.findFirst({
    where: { tenantId: tenant.id, type: 'INFORMATION_TECHNOLOGY' },
  });
  if (itDept) {
    await p.permissionGroupAssignment.upsert({
      where: { id: `assign-${auditorGroup.id}-${itDept.id}` },
      update: {},
      create: { id: `assign-${auditorGroup.id}-${itDept.id}`, groupId: auditorGroup.id, departmentId: itDept.id },
    });
    console.log('group assigned to dept:', itDept.type);
  }

  // 4. Revoke DELETE on a module for one specific staff user
  const salesStaff = await p.user.findFirst({
    where: { tenantId: tenant.id, email: 'staff1.sales@claspcrm.com' },
  });
  const pipelineModule = moduleByPath['/sales/sales-pipeline'];
  if (salesStaff && pipelineModule && permId['DELETE']) {
    await p.permissionOverride.upsert({
      where: {
        tenantId_userId_moduleId_permissionId: {
          tenantId: tenant.id,
          userId: salesStaff.id,
          moduleId: pipelineModule.id,
          permissionId: permId['DELETE'],
        },
      },
      update: { effect: PermissionEffect.REVOKE },
      create: {
        tenantId: tenant.id,
        userId: salesStaff.id,
        moduleId: pipelineModule.id,
        permissionId: permId['DELETE'],
        effect: PermissionEffect.REVOKE,
      },
    });
    console.log('override REVOKE DELETE on', pipelineModule.path, 'for', salesStaff.email);
  }

  // 5. Grant EDIT on a module a staff user normally only has VIEW for
  const itStaff = await p.user.findFirst({
    where: { tenantId: tenant.id, email: 'staff1.information_technology@claspcrm.com' },
  });
  const systemMonitoring = moduleByPath['/it/system-monitoring'];
  if (itStaff && systemMonitoring && permId['EDIT']) {
    await p.permissionOverride.upsert({
      where: {
        tenantId_userId_moduleId_permissionId: {
          tenantId: tenant.id,
          userId: itStaff.id,
          moduleId: systemMonitoring.id,
          permissionId: permId['EDIT'],
        },
      },
      update: { effect: PermissionEffect.GRANT },
      create: {
        tenantId: tenant.id,
        userId: itStaff.id,
        moduleId: systemMonitoring.id,
        permissionId: permId['EDIT'],
        effect: PermissionEffect.GRANT,
      },
    });
    console.log('override GRANT EDIT on', systemMonitoring.path, 'for', itStaff.email);
  }

  const groups = await p.permissionGroup.count({ where: { tenantId: tenant.id } });
  const items = await p.permissionGroupItem.count();
  const assignments = await p.permissionGroupAssignment.count();
  const overrides = await p.permissionOverride.count({ where: { tenantId: tenant.id } });

  console.log({ groups, items, assignments, overrides });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
