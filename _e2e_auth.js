require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const owner = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});
const EMAIL = 'e2e-auth@example.com';
const PASSWORD = 'Test1234!';

async function main() {
  const t = await owner.$queryRawUnsafe(
    `SELECT id FROM tenants ORDER BY "createdAt" LIMIT 1`,
  );
  const tenantId = t[0].id;

  await owner.$executeRawUnsafe(`DELETE FROM users WHERE email = $1`, EMAIL);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await owner.$executeRawUnsafe(
    `INSERT INTO users (id,email,password,name,role,"tenantId","isVerified","createdAt","updatedAt")
     VALUES ('e2e-auth-id',$1,$2,'E2E Auth','ADMIN',$3,true,now(),now())`,
    EMAIL,
    hash,
    tenantId,
  );

  const login = await fetch('http://localhost:3030/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginBody = await login.json();
  console.log('login status:', login.status, 'token:', !!loginBody.accessToken);

  const dash = await fetch('http://localhost:3030/dashboard', {
    headers: { Authorization: `Bearer ${loginBody.accessToken}` },
  });
  const dashText = await dash.text();
  console.log('dashboard status:', dash.status);
  console.log('dashboard body:', dashText);

  await owner.$executeRawUnsafe(`DELETE FROM users WHERE id='e2e-auth-id'`);
  await owner.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('ERR', e.stack || e.message);
  try {
    await owner.$disconnect();
  } catch {}
  process.exit(1);
});
