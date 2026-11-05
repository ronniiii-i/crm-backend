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
const sessionA = { id: crypto.randomUUID() };
const sessionB = { id: crypto.randomUUID() };
const leaveA = { id: crypto.randomUUID() };
const leaveB = { id: crypto.randomUUID() };
const attachmentA = { id: crypto.randomUUID() };
const attachmentB = { id: crypto.randomUUID() };
const preferenceA = { id: crypto.randomUUID() };
const preferenceB = { id: crypto.randomUUID() };
const auditA = { id: crypto.randomUUID() };
const auditB = { id: crypto.randomUUID() };
const contactA = { id: crypto.randomUUID() };
const contactB = { id: crypto.randomUUID() };

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

/**
 * Assert a statement affects exactly `expected` rows inside a tenant context.
 * A dedicated transaction keeps each assertion independent.
 */
async function expectRowCount(
  client,
  tenantId,
  sql,
  params,
  expected,
  message,
) {
  await withTenant(client, tenantId, async () => {
    const result = await client.query(sql, params);
    assert.equal(result.rowCount, expected, message);
  });
}

/**
 * Assert a statement is rejected by RLS in its own transaction, so an aborted
 * transaction never poisons the next assertion.
 */
async function expectDeniedInTenant(client, tenantId, sql, params, message) {
  await withTenant(client, tenantId, async () => {
    try {
      await client.query(sql, params);
    } catch (error) {
      assert.equal(
        error.code,
        '42501',
        `${message}: expected 42501, got ${error.code}`,
      );
      return;
    }
    assert.fail(message);
  });
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

    // Phase 4 tenant-scoped tables: one row per tenant so cross-tenant
    // visibility and write attempts can be asserted.
    await owner.query(
      `INSERT INTO "user_sessions"
         (id, "userId", "tenantId", "userAgent", "expiresAt")
       VALUES
         ($1, $2, $3, 'RLS agent A', now() + interval '1 day'),
         ($4, $5, $6, 'RLS agent B', now() + interval '1 day')`,
      [
        sessionA.id,
        userA.id,
        tenantA.id,
        sessionB.id,
        userB.id,
        tenantB.id,
      ],
    );

    await owner.query(
      `INSERT INTO "leave_requests"
         (id, "tenantId", "userId", type, "startDate", "endDate", days,
          reason, "updatedAt")
       VALUES
         ($1, $2, $3, 'ANNUAL', now(), now() + interval '2 days', 3,
          'RLS leave A', now()),
         ($4, $5, $6, 'SICK', now(), now() + interval '1 day', 2,
          'RLS leave B', now())`,
      [
        leaveA.id,
        tenantA.id,
        userA.id,
        leaveB.id,
        tenantB.id,
        userB.id,
      ],
    );

    await owner.query(
      `INSERT INTO "attachments"
         (id, "tenantId", entity, "entityId", key, "fileName", "mimeType",
          size, "uploadedById")
       VALUES
         ($1, $2, 'Contact', $3, 'rls/a.txt', 'a.txt', 'text/plain', 12,
          $4),
         ($5, $6, 'Contact', $7, 'rls/b.txt', 'b.txt', 'text/plain', 12,
          $8)`,
      [
        attachmentA.id,
        tenantA.id,
        contactA.id,
        userA.id,
        attachmentB.id,
        tenantB.id,
        contactB.id,
        userB.id,
      ],
    );

    await owner.query(
      `INSERT INTO "notification_preferences"
         (id, "tenantId", "userId", type, "inApp", email)
       VALUES
         ($1, $2, $3, 'TASK_ASSIGNED', true, false),
         ($4, $5, $6, 'TASK_ASSIGNED', true, false)`,
      [
        preferenceA.id,
        tenantA.id,
        userA.id,
        preferenceB.id,
        tenantB.id,
        userB.id,
      ],
    );

    await owner.query(
      `INSERT INTO "audit_logs"
         (id, "tenantId", "actorId", action, entity, "moduleKey")
       VALUES
         ($1, $2, $3, 'CREATE', 'Contact', 'contacts'),
         ($4, $5, $6, 'CREATE', 'Contact', 'contacts')`,
      [
        auditA.id,
        tenantA.id,
        userA.id,
        auditB.id,
        tenantB.id,
        userB.id,
      ],
    );

    // Soft-deleted business rows must still obey tenant isolation.
    await owner.query(
      `INSERT INTO "Contact"
         (id, "firstName", "lastName", "userId", "tenantId", "deletedAt",
          "updatedAt")
       VALUES
         ($1, 'Deleted', 'A', $2, $3, now(), now()),
         ($4, 'Deleted', 'B', $5, $6, now(), now())`,
      [contactA.id, userA.id, tenantA.id, contactB.id, userB.id, tenantB.id],
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

  await owner.query('DELETE FROM "audit_logs" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query('DELETE FROM "attachments" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query(
    'DELETE FROM "AttendanceRecord" WHERE "tenantId" = ANY($1)',
    [tenantIds],
  );
  await owner.query('DELETE FROM "leave_requests" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query('DELETE FROM "user_sessions" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
  await owner.query(
    'DELETE FROM "notification_preferences" WHERE "tenantId" = ANY($1)',
    [tenantIds],
  );
  await owner.query('DELETE FROM "Contact" WHERE "tenantId" = ANY($1)', [
    tenantIds,
  ]);
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

async function runPhase4RlsChecks(app) {
  console.log('checking Phase 4 tenant-table isolation');

  const cases = [
    {
      table: 'user_sessions',
      own: sessionA.id,
      foreign: sessionB.id,
      columns: 'id, "deviceLabel"',
    },
    {
      table: 'leave_requests',
      own: leaveA.id,
      foreign: leaveB.id,
      columns: 'id, reason',
    },
    {
      table: 'attachments',
      own: attachmentA.id,
      foreign: attachmentB.id,
      columns: 'id, key',
    },
    {
      table: 'notification_preferences',
      own: preferenceA.id,
      foreign: preferenceB.id,
      columns: 'id, type',
    },
  ];

  for (const testCase of cases) {
    await withTenant(app, tenantA.id, async () => {
      const result = await app.query(
        `SELECT ${testCase.columns} FROM "${testCase.table}" ORDER BY id`,
      );
      assert.deepEqual(
        result.rows.map((row) => row.id),
        [testCase.own],
        `crm_app saw ${testCase.table} rows from another tenant`,
      );
    });

    await withTenant(app, tenantB.id, async () => {
      const result = await app.query(
        `SELECT id FROM "${testCase.table}" ORDER BY id`,
      );
      assert.deepEqual(
        result.rows.map((row) => row.id),
        [testCase.foreign],
        `crm_app saw ${testCase.table} rows from another tenant`,
      );
    });

    await expectRowCount(
      app,
      tenantA.id,
      `UPDATE "${testCase.table}" SET "tenantId" = "tenantId" WHERE id = $1`,
      [testCase.foreign],
      0,
      `crm_app updated a ${testCase.table} row outside the active context`,
    );
    await expectRowCount(
      app,
      tenantA.id,
      `DELETE FROM "${testCase.table}" WHERE id = $1`,
      [testCase.foreign],
      0,
      `crm_app deleted a ${testCase.table} row outside the active context`,
    );
  }

  await expectDeniedInTenant(
    app,
    tenantA.id,
    `INSERT INTO "user_sessions"
       (id, "userId", "tenantId", "expiresAt")
     VALUES ($1, $2, $3, now() + interval '1 day')`,
    [crypto.randomUUID(), userB.id, tenantB.id],
    'crm_app inserted a user_sessions row outside the active context',
  );
  await expectDeniedInTenant(
    app,
    tenantA.id,
    `INSERT INTO "leave_requests"
       (id, "tenantId", "userId", "startDate", "endDate", days, reason,
        "updatedAt")
     VALUES ($1, $2, $3, now(), now(), 1, 'cross tenant', now())`,
    [crypto.randomUUID(), tenantB.id, userB.id],
    'crm_app inserted a leave_requests row outside the active context',
  );
  await expectDeniedInTenant(
    app,
    tenantA.id,
    `INSERT INTO "attachments"
       (id, "tenantId", entity, "entityId", key, "fileName", "mimeType",
        size, "uploadedById")
     VALUES ($1, $2, 'Contact', $3, 'cross.txt', 'cross.txt', 'text/plain',
             1, $4)`,
    [crypto.randomUUID(), tenantB.id, contactB.id, userB.id],
    'crm_app inserted an attachments row outside the active context',
  );
  await expectDeniedInTenant(
    app,
    tenantA.id,
    `INSERT INTO "notification_preferences"
       (id, "tenantId", "userId", type)
     VALUES ($1, $2, $3, $4)`,
    [
      crypto.randomUUID(),
      tenantB.id,
      userB.id,
      `RLS_TEST_${suffix}`,
    ],
    'crm_app inserted a notification_preferences row outside the active context',
  );

  console.log('checking audit log immutability');
  await withTenant(app, tenantA.id, async () => {
    let result = await app.query(
      'SELECT id FROM "audit_logs" ORDER BY id',
    );
    assert.deepEqual(result.rows.map((row) => row.id), [auditA.id]);

    const insert = await app.query(
      `INSERT INTO "audit_logs"
         (id, "tenantId", action, entity)
       VALUES ($1, $2, 'CREATE', 'RLS') RETURNING id`,
      [crypto.randomUUID(), tenantA.id],
    );
    assert.equal(insert.rowCount, 1, 'crm_app could not append an audit row');

    result = await app.query('SELECT id FROM "audit_logs" ORDER BY id');
    assert.equal(result.rowCount, 2);
  });

  await expectDeniedInTenant(
    app,
    tenantA.id,
    `UPDATE "audit_logs" SET action = 'TAMPER' WHERE id = $1`,
    [auditA.id],
    'crm_app updated an audit row',
  );
  await expectDeniedInTenant(
    app,
    tenantA.id,
    `DELETE FROM "audit_logs" WHERE id = $1`,
    [auditA.id],
    'crm_app deleted an audit row',
  );

  console.log('checking soft-delete isolation');
  await withTenant(app, tenantA.id, async () => {
    const result = await app.query(
      'SELECT id, "deletedAt" FROM "Contact" ORDER BY id',
    );
    assert.deepEqual(result.rows.map((row) => row.id), [contactA.id]);
    assert.ok(result.rows[0].deletedAt, 'soft-deleted row was not returned');
  });
  await expectRowCount(
    app,
    tenantA.id,
    'UPDATE "Contact" SET "firstName" = \'x\' WHERE id = $1',
    [contactB.id],
    0,
    'crm_app updated a soft-deleted Contact from another tenant',
  );
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
    result.rows.map((row) => row.id).sort(),
    [tenantA.id, tenantB.id].sort(),
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
    await runPhase4RlsChecks(app);

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
