const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const tenant = await p.tenant.findUnique({ where: { slug: 'default' } });
  const modules = await p.module.findMany({ where: { tenantId: tenant.id }, include: { department: true } });
  for (const m of modules) {
    console.log(`${m.path}  |  ${m.name}  |  dept=${m.department ? m.department.type : 'GLOBAL'}`);
  }
}
main().finally(() => p.$disconnect());
