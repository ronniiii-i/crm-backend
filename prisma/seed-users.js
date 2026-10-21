const { PrismaClient, Role, DepartmentType } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

const DEFAULT_PASSWORD = 'Password123!';
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

async function main() {
  const tenant = await p.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error('tenant not found, run prisma db seed first');
  
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  
  const depts = await p.department.findMany({ where: { tenantId: tenant.id } });
  const deptMap = Object.fromEntries(depts.map(d => [d.type, d]));
  
  // Admin
  await p.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@claspcrm.com' } },
    update: {},
    create: { tenantId: tenant.id, email: 'admin@claspcrm.com', password: hash, name: 'System Admin', role: Role.ADMIN, isVerified: true },
  });
  
  // HODs per department
  for (const [type, dept] of Object.entries(deptMap)) {
    const hodEmail = `hod.${type.toLowerCase()}@claspcrm.com`;
    const hod = await p.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: hodEmail } },
      update: { departmentId: dept.id },
      create: { tenantId: tenant.id, email: hodEmail, password: hash, name: `${dept.name} HOD`, role: Role.HOD, departmentId: dept.id, isVerified: true },
    });
    await p.department.update({ where: { id: dept.id }, data: { managerId: hod.id } });
  }
  
  // Leads and staff
  for (const [type, dept] of Object.entries(deptMap)) {
    const lead = await p.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: `lead.${type.toLowerCase()}@claspcrm.com` } },
      update: { departmentId: dept.id },
      create: { tenantId: tenant.id, email: `lead.${type.toLowerCase()}@claspcrm.com`, password: hash, name: `${dept.name} Lead`, role: Role.LEAD, departmentId: dept.id, isVerified: true },
    });
    for (let i=1; i<=2; i++) {
      await p.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: `staff${i}.${type.toLowerCase()}@claspcrm.com` } },
        update: { departmentId: dept.id },
        create: { tenantId: tenant.id, email: `staff${i}.${type.toLowerCase()}@claspcrm.com`, password: hash, name: `${dept.name} Staff ${i}`, role: Role.STAFF, departmentId: dept.id, isVerified: true },
      });
    }
    // Create team
    const team = await p.team.upsert({
      where: { id: `${tenant.id}-team-${type}` },
      update: {},
      create: { id: `${tenant.id}-team-${type}`, tenantId: tenant.id, departmentId: dept.id, name: `${dept.name} Team`, leadUserId: lead.id },
    });
    // Add staff to team
    const staffMembers = await p.user.findMany({ where: { tenantId: tenant.id, departmentId: dept.id, role: Role.STAFF } });
    for (const s of staffMembers) {
      await p.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: s.id } },
        update: {},
        create: { tenantId: tenant.id, teamId: team.id, userId: s.id, role: 'Member' },
      });
    }
  }
  
  const count = await p.user.count({ where: { tenantId: tenant.id } });
  console.log('Users in tenant:', count);
  console.log('Password for all:', DEFAULT_PASSWORD);
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
