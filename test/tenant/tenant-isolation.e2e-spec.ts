// test/tenant/tenant-isolation.e2e-spec.ts
//
// Zero-trust checks for the multi-tenant layer:
//   * a scoped query made *without* a tenant context returns zero rows
//     (fail-closed) — mirrors Postgres RLS with no `app.current_tenant` set
//   * a scoped query under tenant A never returns tenant B's rows
//   * the tenant id is taken from the request context, never from the body
//   * cache keys are always tenant-prefixed

import { createFakePrisma } from '../utils/fake-prisma';
import { expectNoForeignRows } from '../utils/fail-closed';
import {
  CacheService,
  InMemoryRedisClient,
} from '../../src/cache/cache.service';
import { getTenantId, runWithTenant } from '../../src/tenant/tenant-context';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Tenant isolation', () => {
  describe('RLS fail-closed', () => {
    it('returns zero rows for a scoped query with no tenant context', async () => {
      const prisma = createFakePrisma({
        contacts: [
          { id: 'c1', tenantId: TENANT_A, name: 'Acme' },
          { id: 'c2', tenantId: TENANT_B, name: 'Globex' },
        ],
      });

      const rows = await prisma.contact.findMany({});
      expect(rows).toHaveLength(0);
    });

    it('returns only the active tenant rows once a tenant is set', async () => {
      const prisma = createFakePrisma({
        contacts: [
          { id: 'c1', tenantId: TENANT_A, name: 'Acme' },
          { id: 'c2', tenantId: TENANT_B, name: 'Globex' },
        ],
      });

      const rows = await prisma.withTenant(TENANT_A, (tx) =>
        tx.contact.findMany({}),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(TENANT_A);
      expectNoForeignRows(rows, TENANT_A);
    });

    it('never leaks rows across a tenant switch', async () => {
      const prisma = createFakePrisma({
        deals: [
          { id: 'd1', tenantId: TENANT_A, title: 'A deal' },
          { id: 'd2', tenantId: TENANT_B, title: 'B deal' },
        ],
      });

      const a = await prisma.withTenant(TENANT_A, (tx) => tx.deal.findMany({}));
      const b = await prisma.withTenant(TENANT_B, (tx) => tx.deal.findMany({}));

      expect(a.map((r: any) => r.id)).toEqual(['d1']);
      expect(b.map((r: any) => r.id)).toEqual(['d2']);
    });
  });

  describe('tenant context', () => {
    it('exposes no tenant id outside a tenant scope', () => {
      expect(getTenantId()).toBeUndefined();
    });

    it('exposes the tenant id inside a tenant scope', async () => {
      await runWithTenant(TENANT_A, async () => {
        expect(getTenantId()).toBe(TENANT_A);
      });
    });

    it('restores the previous tenant when the scope exits', async () => {
      await runWithTenant(TENANT_A, async () => {
        expect(getTenantId()).toBe(TENANT_A);
      });
      expect(getTenantId()).toBeUndefined();
    });

    it('keeps concurrent tenant scopes isolated', async () => {
      const results = await Promise.all([
        runWithTenant(TENANT_A, async () => {
          await new Promise((r) => setTimeout(r, 20));
          return getTenantId();
        }),
        runWithTenant(TENANT_B, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getTenantId();
        }),
      ]);

      expect(results).toEqual([TENANT_A, TENANT_B]);
    });
  });

  describe('cache key scoping', () => {
    let cache: CacheService;

    beforeEach(async () => {
      cache = new CacheService(() => new InMemoryRedisClient());
      await cache.onModuleInit();
    });

    afterEach(async () => {
      await cache.onModuleDestroy();
    });

    it('prefixes every key with the tenant namespace', () => {
      expect(cache.tenantKey('user:1:modules', TENANT_A)).toBe(
        `tenant:${TENANT_A}:user:1:modules`,
      );
    });

    it('never returns tenant A cached data for tenant B', async () => {
      await cache.set(cache.tenantKey('user:1:modules', TENANT_A), [
        'dashboard',
      ]);
      await cache.set(cache.tenantKey('user:1:modules', TENANT_B), [
        'settings',
      ]);

      await expect(
        cache.get(cache.tenantKey('user:1:modules', TENANT_A)),
      ).resolves.toEqual(['dashboard']);
      await expect(
        cache.get(cache.tenantKey('user:1:modules', TENANT_B)),
      ).resolves.toEqual(['settings']);
    });

    it('invalidates only the target tenant', async () => {
      await cache.set(cache.tenantKey('k', TENANT_A), 'a');
      await cache.set(cache.tenantKey('k', TENANT_B), 'b');

      await cache.flushTenant(TENANT_A);

      await expect(
        cache.get(cache.tenantKey('k', TENANT_A)),
      ).resolves.toBeUndefined();
      await expect(cache.get(cache.tenantKey('k', TENANT_B))).resolves.toBe(
        'b',
      );
    });

    it('produces a global namespace when no tenant is active', () => {
      expect(cache.tenantKey('k')).toBe('tenant:global:k');
    });

    it('keeps entries for different users in the same tenant isolated', async () => {
      await cache.set(cache.tenantKey('user:1:modules', TENANT_A), 'one');
      await cache.set(cache.tenantKey('user:2:modules', TENANT_A), 'two');

      await cache.invalidateUser('1', TENANT_A);

      await expect(
        cache.get(cache.tenantKey('user:1:modules', TENANT_A)),
      ).resolves.toBeUndefined();
      await expect(
        cache.get(cache.tenantKey('user:2:modules', TENANT_A)),
      ).resolves.toBe('two');
    });
  });
});
