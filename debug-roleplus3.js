const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
const PermissionEffect = { GRANT: 'GRANT', REVOKE: 'REVOKE' };
async function main() {
  const tenant = await p.tenant.findUnique({ where: { slug: 'default' } });
  const user = await p.user.findFirst({ where: { tenantId: tenant.id, email: 'staff1.information_technology@claspcrm.com' } });
  const userForAcl = { id: user.id, role: user.role, tenantId: tenant.id, departmentId: user.departmentId };
  
  const details = new Map();
  const ensure = (moduleId, permissionType) => {
    const key = `${moduleId}:${permissionType}`;
    if (!details.has(key)) {
      details.set(key, { moduleId, permissionType, granted: false, sources: [] });
    }
    return details.get(key);
  };
  
  const rolePermissions = await p.roleModulePermission.findMany({ where: { role: user.role }, include: { permission: true } });
  for (const rolePermission of rolePermissions) {
    const entry = ensure(rolePermission.moduleId, rolePermission.permission.type);
    entry.granted = true;
    entry.sources.push({ type: 'ROLE' });
  }
  
  const assignments = await p.permissionGroupAssignment.findMany({
    where: { OR: [{ userId: user.id }, ...(userForAcl.departmentId ? [{ departmentId: userForAcl.departmentId }] : [])] },
    include: { group: { include: { items: { include: { permission: true } } } } },
  });
  for (const assignment of assignments) {
    for (const item of assignment.group.items) {
      const entry = ensure(item.moduleId, item.permission.type);
      entry.granted = true;
      entry.sources.push({ type: 'GROUP', groupId: assignment.group.id, groupName: assignment.group.name });
    }
  }
  
  const overrides = await p.permissionOverride.findMany({ where: { userId: user.id }, include: { permission: true } });
  for (const override of overrides) {
    const entry = ensure(override.moduleId, override.permission.type);
    if (override.effect === PermissionEffect.GRANT) {
      entry.granted = true;
    } else {
      entry.granted = false;
    }
    entry.sources.push({ type: 'OVERRIDE', effect: override.effect });
  }
  
  for (const [k, v] of details.entries()) {
    if (v.sources.some(s => s.type !== 'ROLE')) {
      const roleGrant = v.sources.some(s => s.type === 'ROLE');
      const nonRole = v.sources.some(s => s.type !== 'ROLE');
      console.log(k, 'granted:', v.granted, 'roleGrant:', roleGrant, 'nonRole:', nonRole, 'diff:', v.granted !== roleGrant);
    }
  }
}
main().finally(() => p.$disconnect());
