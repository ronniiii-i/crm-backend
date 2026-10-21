const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const tenant = await p.tenant.findUnique({ where: { slug: 'default' } });
  const user = await p.user.findFirst({ where: { tenantId: tenant.id, email: 'staff1.sales@claspcrm.com' } });
  console.log('user role:', user.role);
  const rolePerms = await p.roleModulePermission.findMany({ where: { role: user.role } });
  console.log('role perms count:', rolePerms.length);
  const overrides = await p.permissionOverride.findMany({ where: { userId: user.id } });
  console.log('overrides:', overrides.length);
  for (const o of overrides) {
    const perm = await p.permission.findUnique({ where: { id: o.permissionId } });
    const mod = await p.module.findUnique({ where: { id: o.moduleId } });
    console.log('override:', mod.path, perm.type, o.effect);
  }
}
main().finally(() => p.$disconnect());
