require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const EMAIL = 'e2e-login@example.com';
const PASSWORD = 'Test1234!';

async function main() {
  const tenant = await owner.$queryRawUnsafe(
    `SELECT id FROM tenants ORDER BY "createdAt" LIMIT 1`,
  );
  if (!tenant.length) throw new Error('no tenant seeded');
  const tenantId = tenant[0].id;

  await owner.$executeRawUnsafe(`DELETE FROM users WHERE email = $1`, EMAIL);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await owner.$executeRawUnsafe(
    `INSERT INTO users (id,email,password,name,role,"tenantId","isVerified","createdAt","updatedAt")
     VALUES ('e2e-login-id',$1,$2,'E2E Login','ADMIN',$3,true,now(),now())`,
    EMAIL, hash, tenantId,
  );

  // Call the live login endpoint.
  const res = await fetch('http://localhost:3030/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const body = await res.json().catch(() => ({}));
  console.log('HTTP', res.status);
  console.log('success:', body.success);
  console.log('has accessToken:', typeof body.accessToken === 'string' && body.accessToken.length > 20);
  console.log('user.role:', body.user?.role);
  console.log('accessibleModules count:', body.user?.accessibleModules?.length ?? 0);

  // Decode the JWT payload (no verify) to confirm tenantId is present.
  let payloadTenant = null;
  if (body.accessToken) {
    const part = body.accessToken.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    payloadTenant = payload.tenantId;
    console.log('jwt.tenantId matches:', payload.tenantId === tenantId);
  }

  // Cleanup
  await owner.$executeRawUnsafe(`DELETE FROM users WHERE id='e2e-login-id'`);
  await owner.$disconnect();

  const ok =
    res.status === 200 || res.status === 201
      ? body.success === true &&
        !!body.accessToken &&
        payloadTenant === tenantId &&
        (body.user?.accessibleModules?.length ?? 0) > 0
      : false;

  console.log('\nOVERALL:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERR', e.message);
  try { await owner.$disconnect(); } catch {}
  process.exit(1);
});
