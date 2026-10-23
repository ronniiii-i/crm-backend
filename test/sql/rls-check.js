'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');

require('dotenv').config();

const ownerUrl = process.env.DIRECT_URL;
const appUrl = process.env.DATABASE_URL;
const systemUrl = process.env.SYSTEM_DATABASE_URL;

if (!ownerUrl || !appUrl || !systemUrl) {
  console.error(
    'RLS checks require DIRECT_URL, DATABASE_URL, and SYSTEM_DATABASE_URL in .env.',
  );
  process.exit(1);
}

const suffix = crypto.randomBytes(5).toString('hex');
const tenantA = {
  id: crypto.randomUUID(),
  name: `RLS Test A ${suffix}`,
  slug: `rls-test-a-${suffix}`,
};
const tenantB = {
  id: crypto.randomUUID(),
  name: `RLS Test B ${suffix}`,
  slug: `rls-test-b-${suffix}`,
};
const roleA = {
  id: crypto.randomUUID(),
  slug: `tenant-admin-${suffix}`,
};
const roleB = {
  id: crypto.randomUUID(),
  slug: `member-${suffix}`,
};
const userA = {
  id: crypto.randomUUID(),
  email: `rls-a-${suffix}@example.test`,
};
const userB = {
  id: crypto.randomUUID(),
  email: `rls-b-${suffix}@example.test`,
};
const systemAdmin = {
  id: crypto.randomUUID(),
  email: `rls-system-${suffix}@example.test`,
};
const lifecycleEvent = {
  id: crypto.randomUUID(),
};
const permissionGroup = {
  id: crypto.randomUUID(),
};

async function connect(url, label) {
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log(`connected: ${label}`);
  return client;
}

async function expectPermissionDenied(client, sql, params = []) {
  try {
    await client.query(sql, params);
  } catch (error) {
    assert.equal(
      error.code,
      '42501',
      `expected permission denied (42501), got ${error.code}: ${error.message}`,
    );
    return;
  }

  assert.fail(`expected permission denied for: ${sql}`);
}

async function withTenant(client, tenantId, callback) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantId,
    ]);
    await callback();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function seed(owner) {
  await owner.query('BEGIN');
  try {
    await owner.query(
      `INSERT INTO "tenants" (id, name, slug, status, "updatedAt")
       VALUES ($1, $2, $3, 'TRIAL', now()), ($4, $5, $6, 'TRIAL', now())`,
      [
        tenantA.id,
        tenantA.name,
        tenantA.slug,
        tenantB.id,
        tenantB.name,
        tenantB.slug,
      ],
    );

    await owner.query(
      `INSERT INTO "roles"
         (id, "tenantId", name, slug, "isTenantAdmin", "dataScope", "updatedAt")
       VALUES
         ($1, $2, 'Tenant Admin', $3, true, 'TENANT', now()),
         ($4, $5, 'Member', $6, false, 'SELF', now())`,
      [
        roleA.id,
        tenantA.id,
        roleA.slug,
        roleB.id,
        tenantB.id,
        roleB.slug,
      ],
    );

    await owner.query(
      `INSERT INTO "users"
         (id, email, password, name, "roleId", "tenantId", "updatedAt")
       VALUES
         ($1, $2, 'not-a-real-hash', 'RLS User A', $3, $4, now()),
         ($5, $6, 'not-a-real-hash', 'RLS User B', $7, $8, now())`,
      [
        userA.id,
        userA.email,
        roleA.id,
        tenantA.id,
        userB.id,
        userB.email,
        roleB.id,
        tenantB.id,
      ],
    );

    await owner.query(
      `INSERT INTO "system_admins"
         (id, email, password, name, role, "updatedAt")
       VALUES ($1, $2, 'not-a-real-hash', 'RLS System Admin', 'SUPER_ADMIN', now())`,
      [systemAdmin.id, systemAdmin.email],
    );

    await owner.query(
      `INSERT INTO "tenant_lifecycle_events"
         (id, "tenantId", "actorSystemAdminId", "fromStatus", "toStatus", reason)
       VALUES ($1, $2, $3, 'TRIAL', 'ACTIVE', 'RLS verification')`,
      [lifecycleEvent.id, tenantA.id, systemAdmin.id],
    );

    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function cleanup(owner) {
  const tenantIds = [tenantA.id, tenantB.id];

  await owner.query(
    'DELETE FROM "tenant_lifecycle_events" WHERE "tenantId" = ANY($1)',
    [tenantIds],
  );
  await owner.query('DELETE FROM "system_admins" WHERE id = $1', [
    systemAdmin.id,
  ]);
  await owner.query('DELETE FROM "invitations" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query(
    'DELETE FROM "permission_group_assignments" WHERE "tenantId" = ANY($1)',
    [tenantIds],
  );
  await owner.query(
    'DELETE FROM "permission_group_items" WHERE "tenantId" = ANY($1)',
    [tenantIds],
  );
  await owner.query('DELETE FROM "permission_groups" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query('DELETE FROM "users" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query('DELETE FROM "roles" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query('DELETE FROM "tenants" WHERE id = ANY($1)', [tenantIds]);
}

async function runInvariantChecks(owner) {
  // Partial unique index: one Tenant Admin role per tenant.
  await owner.query('BEGIN');
  try {
    await assert.rejects(
      owner.query(
        `INSERT INTO "roles"
           (id, "tenantId", name, slug, "isTenantAdmin", "dataScope", "updatedAt")
         VALUES ($1, $2, 'Second Tenant Admin', $3, true, 'TENANT', now())`,
        [crypto.randomUUID(), tenantA.id, `second-admin-${suffix}`],
      ),
      (error) => error.code === '23505',
      'expected roles_one_tenant_admin_per_tenant to reject a second admin',
    );
  } finally {
    await owner.query('ROLLBACK');
  }

  // Partial unique index: one pending invitation per normalized email/tenant.
  await owner.query('BEGIN');
  try {
    const inviteEmail = `rls-invite-${suffix}@example.test`;
    await owner.query(
      `INSERT INTO "invitations"
         (id, "tenantId", email, "tokenHash", status, "roleId",
          "invitedByUserId", "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PENDING', $5, $6,
               now() + interval '7 days', now())`,
      [
        crypto.randomUUID(),
        tenantA.id,
        inviteEmail,
        crypto.randomBytes(32).toString('hex'),
        roleA.id,
        userA.id,
      ],
    );

    await assert.rejects(
      owner.query(
        `INSERT INTO "invitations"
           (id, "tenantId", email, "tokenHash", status, "roleId",
            "invitedByUserId", "expiresAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6,
                 now() + interval '7 days', now())`,
        [
          crypto.randomUUID(),
          tenantA.id,
          inviteEmail,
          crypto.randomBytes(32).toString('hex'),
          roleA.id,
          userA.id,
        ],
      ),
      (error) => error.code === '23505',
      'expected invitations_one_pending_per_email to reject a duplicate',
    );
  } finally {
    await owner.query('ROLLBACK');
  }

  // Check constraint: an assignment targets exactly one of user or department.
  await owner.query('BEGIN');
  try {
    await owner.query(
      `INSERT INTO "permission_groups" (id, name, "tenantId", "updatedAt")
       VALUES ($1, $2, $3, now())`,
      [permissionGroup.id, `RLS Group ${suffix}`, tenantA.id],
    );

    await assert.rejects(
      owner.query(
        `INSERT INTO "permission_group_assignments"
           (id, "tenantId", "groupId")
         VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), tenantA.id, permissionGroup.id],
      ),
      (error) => error.code === '23514',
      'expected permission_group_assignments_target_check to reject a targetless assignment',
    );
  } finally {
    await owner.query('ROLLBACK');
  }
}

async function runRlsChecks(app, system) {
  console.log('checking crm_app without tenant context');
  let result = await app.query('SELECT id FROM "tenants"');
  assert.equal(result.rowCount, 0, 'crm_app saw tenants without a context');
  result = await app.query('SELECT id FROM "users"');
  assert.equal(result.rowCount, 0, 'crm_app saw users without a context');
  result = await app.query('SELECT id FROM "roles"');
  assert.equal(result.rowCount, 0, 'crm_app saw roles without a context');
  await app.query('SELECT id FROM "permissions" LIMIT 1');

  console.log('checking crm_app tenant A isolation');
  await withTenant(app, tenantA.id, async () => {
    result = await app.query('SELECT id FROM "tenants" ORDER BY id');
    assert.deepEqual(
      result.rows.map((row) => row.id),
      [tenantA.id],
      'crm_app saw the wrong tenant registry row',
    );

    result = await app.query('SELECT id FROM "users" ORDER BY id');
    assert.deepEqual(
      result.rows.map((row) => row.id),
      [userA.id],
      'crm_app saw a user from another tenant',
    );

    result = await app.query('SELECT id FROM "roles" ORDER BY id');
    assert.deepEqual(
      result.rows.map((row) => row.id),
      [roleA.id],
      'crm_app saw a role from another tenant',
    );

    const update = await app.query(
      'UPDATE "tenants" SET name = name WHERE id = $1',
      [tenantB.id],
    );
    assert.equal(
      update.rowCount,
      0,
      'crm_app updated a tenant outside the active context',
    );

    await assert.rejects(
      app.query(
        `INSERT INTO "users"
           (id, email, password, name, "roleId", "tenantId", "updatedAt")
         VALUES ($1, $2, 'not-a-real-hash', 'Cross Tenant User', $3, $4, now())`,
        [
          crypto.randomUUID(),
          `cross-tenant-${suffix}@example.test`,
          roleB.id,
          tenantB.id,
        ],
      ),
      (error) => error.code === '42501',
      'crm_app inserted a user outside the active context',
    );
  });

  console.log('checking crm_app tenant B isolation');
  await withTenant(app, tenantB.id, async () => {
    result = await app.query('SELECT id FROM "tenants" ORDER BY id');
    assert.deepEqual(result.rows.map((row) => row.id), [tenantB.id]);

    result = await app.query('SELECT id FROM "users" ORDER BY id');
    assert.deepEqual(result.rows.map((row) => row.id), [userB.id]);
  });

  console.log('checking public lookup functions');
  result = await app.query(
    'SELECT * FROM public.public_workspace_lookup($1)',
    [tenantA.slug],
  );
  assert.equal(result.rowCount, 1);
  assert.deepEqual(
    Object.keys(result.rows[0]).sort(),
    ['id', 'name', 'slug', 'status'],
    'public_workspace_lookup returned an unexpected column set',
  );
  assert.equal(result.rows[0].id, tenantA.id);
  assert.equal(result.rows[0].slug, tenantA.slug);
  assert.equal(result.rows[0].status, 'TRIAL');

  result = await app.query(
    'SELECT * FROM public.public_workspace_lookup($1)',
    [`missing-${suffix}`],
  );
  assert.equal(result.rowCount, 0);

  result = await app.query(
    'SELECT public.tenant_slug_available($1) AS available',
    [`available-${suffix}`],
  );
  assert.equal(result.rows[0].available, true);

  result = await app.query(
    'SELECT public.tenant_slug_available($1) AS available',
    [tenantA.slug],
  );
  assert.equal(result.rows[0].available, false);

  console.log('checking crm_system firewall');
  result = await system.query(
    'SELECT id FROM "tenants" WHERE id = ANY($1) ORDER BY id',
    [[tenantA.id, tenantB.id]],
  );
  assert.deepEqual(
    result.rows.map((row) => row.id),
    [tenantA.id, tenantB.id],
    'crm_system could not read tenant registry rows',
  );

  result = await system.query(
    'SELECT id FROM "system_admins" WHERE id = $1',
    [systemAdmin.id],
  );
  assert.deepEqual(result.rows.map((row) => row.id), [systemAdmin.id]);

  result = await system.query(
    'SELECT id FROM "tenant_lifecycle_events" WHERE id = $1',
    [lifecycleEvent.id],
  );
  assert.deepEqual(result.rows.map((row) => row.id), [lifecycleEvent.id]);

  await expectPermissionDenied(system, 'SELECT id FROM "permissions" LIMIT 1');
  await expectPermissionDenied(system, 'SELECT id FROM "users" LIMIT 1');
  await expectPermissionDenied(system, 'SELECT id FROM "roles" LIMIT 1');
  await expectPermissionDenied(system, 'SELECT id FROM "invitations" LIMIT 1');
  await expectPermissionDenied(system, 'SELECT id FROM "Project" LIMIT 1');

  await expectPermissionDenied(app, 'SELECT id FROM "system_admins" LIMIT 1');
  await expectPermissionDenied(
    app,
    'SELECT id FROM "tenant_lifecycle_events" LIMIT 1',
  );
}

async function main() {
  let owner;
  let app;
  let system;
  let seeded = false;

  try {
    owner = await connect(ownerUrl, 'owner');
    app = await connect(appUrl, 'crm_app');
    system = await connect(systemUrl, 'crm_system');

    await seed(owner);
    seeded = true;

    await runInvariantChecks(owner);
    await runRlsChecks(app, system);

    console.log('RLS checks passed');
  } finally {
    if (seeded && owner) {
      await cleanup(owner).catch((error) => {
        console.error(`cleanup failed: ${error.message}`);
      });
    }

    if (system) await system.end().catch(() => undefined);
    if (app) await app.end().catch(() => undefined);
    if (owner) await owner.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
