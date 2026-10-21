const BASE = process.env.API_BASE || 'http://localhost:3030';
const PASSWORD = 'Password123!';

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

(async () => {
  const admin = await login('admin@claspcrm.com');
  console.log('admin login ok');

  const adminPerms = await get(admin.accessToken, '/auth/acl/permissions');
  console.log('admin permissions status:', adminPerms.status);
  console.log('admin enhanced (Role+):', adminPerms.body.enhanced);
  console.log('admin perm count:', adminPerms.body.permissions?.length);

  const adminModules = await get(admin.accessToken, '/auth/acl/modules');
  console.log('admin modules:', adminModules.body.length);

  // Finance HOD has a group grant
  const finHod = await login('hod.finance@claspcrm.com');
  const finPerms = await get(finHod.accessToken, '/auth/acl/permissions');
  console.log('\nfinance HOD enhanced (Role+):', finPerms.body.enhanced);
  const finGroups = finPerms.body.permissions?.filter(p => p.sources?.some(s => s.type === 'GROUP'));
  console.log('finance HOD group-sourced perms:', finGroups?.length);
  console.log('sample group source:', JSON.stringify(finGroups?.[0], null, 2));

  const finModules = await get(finHod.accessToken, '/auth/acl/modules');
  console.log('finance HOD modules:', finModules.body.map(m => m.path));

  // IT staff has a GRANT override
  const itStaff = await login('staff1.information_technology@claspcrm.com');
  const itPerms = await get(itStaff.accessToken, '/auth/acl/permissions');
  console.log('\nIT staff enhanced (Role+):', itPerms.body.enhanced);
  const itOverrides = itPerms.body.permissions?.filter(p => p.sources?.some(s => s.type === 'OVERRIDE'));
  console.log('IT staff override perms:', JSON.stringify(itOverrides, null, 2));

  // Sales staff has a REVOKE override
  const salesStaff = await login('staff1.sales@claspcrm.com');
  const salesPerms = await get(salesStaff.accessToken, '/auth/acl/permissions');
  console.log('\nsales staff enhanced (Role+):', salesPerms.body.enhanced);
  const salesOverrides = salesPerms.body.permissions?.filter(p => p.sources?.some(s => s.type === 'OVERRIDE'));
  console.log('sales staff override perms:', JSON.stringify(salesOverrides, null, 2));

  // check-permission endpoint
  const pipelineModule = salesStaff.body ? null : null;
  const mods = await get(admin.accessToken, '/auth/acl/modules');
  const salesPipeline = mods.body.find(m => m.path === '/sales/sales-pipeline');
  if (salesPipeline) {
    const del = await get(salesStaff.accessToken, `/auth/acl/check-permission/${salesPipeline.id}/DELETE`);
    const view = await get(salesStaff.accessToken, `/auth/acl/check-permission/${salesPipeline.id}/VIEW`);
    console.log('\nsales staff pipeline DELETE (should be false):', del.body.hasPermission);
    console.log('sales staff pipeline VIEW (should be true):', view.body.hasPermission);
  }

  // IT staff granted EDIT on system monitoring
  const itModules = await get(itStaff.accessToken, '/auth/acl/modules');
  const sysMon = itModules.body.find(m => m.path === '/it/system-monitoring');
  if (sysMon) {
    const edit = await get(itStaff.accessToken, `/auth/acl/check-permission/${sysMon.id}/EDIT`);
    console.log('IT staff system-monitoring EDIT (should be true):', edit.body.hasPermission);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
