// test/perf/workspace-performance.e2e-spec.ts
//
// Real-database performance gate for the Stage 8 checklist:
// "Verify query performance on 10k+ record tables (<300ms API response)".
//
// This suite is skipped unless performance credentials are supplied:
//
//   PERF_DATABASE_URL  runtime connection (crm_app role, RLS enabled)
//   PERF_DIRECT_URL    owner connection used only to seed/clean the fixture
//                      (defaults to PERF_DATABASE_URL when omitted)
//
// It expects the Stage 7 demo seed to be present (`acme` workspace with the
// `admin@acme.test` tenant admin). The fixture rows are namespaced with the
// `perf-` email prefix and removed before and after the run.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType, PrismaClient } from '@prisma/client';
import * as request from 'supertest';

import { PrismaService } from '../../src/prisma/prisma.service';
import {
  CacheService,
  InMemoryRedisClient,
  REDIS_CLIENT_FACTORY,
} from '../../src/cache/cache.service';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { WorkspaceController } from '../../src/workspace/workspace.controller';
import { AggregateController } from '../../src/workspace/controllers/aggregate.controller';
import { CatalogController } from '../../src/workspace/controllers/catalog.controller';
import { DocumentsController } from '../../src/workspace/controllers/documents.controller';
import { RecordsController } from '../../src/workspace/controllers/records.controller';
import { SubmissionsController } from '../../src/workspace/controllers/submissions.controller';
import { ModulePermissionGuard } from '../../src/workspace/guards/module-permission.guard';
import { AggregationService } from '../../src/workspace/services/aggregation.service';
import { AuditService } from '../../src/workspace/services/audit.service';
import { DocumentService } from '../../src/workspace/services/document.service';
import { EntityQueryService } from '../../src/workspace/services/entity-query.service';
import { EntityRegistryService } from '../../src/workspace/services/entity-registry.service';
import { EntityWriteService } from '../../src/workspace/services/entity-write.service';
import { FormSubmissionService } from '../../src/workspace/services/form-submission.service';
import { ModuleAccessService } from '../../src/workspace/services/module-access.service';
import { ModuleConfigService } from '../../src/workspace/services/module-config.service';
import { ScopeFilterService } from '../../src/workspace/services/scope-filter.service';

const APP_URL = process.env.PERF_DATABASE_URL;
const OWNER_URL = process.env.PERF_DIRECT_URL ?? APP_URL;
const RECORD_TARGET = Number(process.env.PERF_RECORD_COUNT ?? 10_000);
const SAMPLE_COUNT = Number(process.env.PERF_SAMPLES ?? 10);
const EMAIL_PREFIX = 'perf-';
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? 300);

const enabled = Boolean(APP_URL);
const describePerf = enabled ? describe : describe.skip;

interface PerfActor {
  id: string;
  tenantId: string;
  roleId: string;
  roleSlug: string;
  dataScope: 'TENANT';
  departmentId: string | null;
  managedDepartmentId: null;
  isTenantAdmin: true;
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

describePerf('Workspace performance (Stage 8)', () => {
  jest.setTimeout(180_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let owner: PrismaClient;
  let actor: PerfActor;
  let tenantId: string;

  beforeAll(async () => {
    // PrismaService resolves its datasource from DATABASE_URL.
    process.env.DATABASE_URL = APP_URL!;

    owner = new PrismaClient({
      datasources: { db: { url: OWNER_URL! } },
    });

    const tenant = await owner.tenant.findUnique({
      where: { slug: 'acme' },
      select: { id: true },
    });
    if (!tenant) {
      throw new Error(
        'Performance fixture requires the seeded `acme` tenant. Run `npm run db:seed:demo` first.',
      );
    }
    tenantId = tenant.id;

    const admin = await owner.user.findFirst({
      where: { tenantId, email: 'admin@acme.test' },
      select: { id: true, roleId: true, role: { select: { slug: true } } },
    });
    if (!admin) {
      throw new Error(
        'Performance fixture requires `admin@acme.test` in the acme tenant.',
      );
    }

    actor = {
      id: admin.id,
      tenantId,
      roleId: admin.roleId,
      roleSlug: admin.role.slug,
      dataScope: 'TENANT',
      departmentId: null,
      managedDepartmentId: null,
      isTenantAdmin: true,
    };

    await owner.$executeRawUnsafe(
      'DELETE FROM "Contact" WHERE "tenantId" = $1 AND email LIKE $2',
      tenantId,
      `${EMAIL_PREFIX}%@example.test`,
    );

    await owner.$executeRawUnsafe(
      `INSERT INTO "Contact"
         (id, "firstName", "lastName", email, phone, company, "jobTitle", notes,
          status, "userId", "tenantId", "createdAt", "updatedAt", tags, "customFields")
       SELECT gen_random_uuid()::text,
              'Perf',
              'Contact ' || g,
              $3 || g || '@example.test',
              '+1-555-' || lpad(g::text, 4, '0'),
              'Performance Co',
              'Load tester',
              'Stage 8 performance fixture',
              'Qualified',
              $1,
              $2,
              now() - (g || ' seconds')::interval,
              now() - (g || ' seconds')::interval,
              ARRAY['perf'],
              '{}'::jsonb
       FROM generate_series(1, $4::int) AS g`,
      admin.id,
      tenantId,
      EMAIL_PREFIX,
      RECORD_TARGET,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [
        WorkspaceController,
        RecordsController,
        AggregateController,
        DocumentsController,
        SubmissionsController,
        CatalogController,
      ],
      providers: [
        PrismaService,
        EntityRegistryService,
        ScopeFilterService,
        ModuleConfigService,
        ModuleAccessService,
        AuditService,
        EntityQueryService,
        EntityWriteService,
        AggregationService,
        DocumentService,
        FormSubmissionService,
        ModulePermissionGuard,
        CacheService,
        {
          provide: REDIS_CLIENT_FACTORY,
          useValue: () => new InMemoryRedisClient(),
        },
        {
          // Tenant admins bypass permission lookup; the WorkspaceController
          // config path still calls the resolver for non-admins.
          provide: PermissionResolutionService,
          useValue: {
            getEffectivePermissions: async () =>
              new Map<string, Set<PermissionType>>(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    (app as any).use((req: any, _res: any, next: any) => {
      req.user = actor;
      next();
    });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$connect();
    // Wait for async lifecycle (onModuleInit) to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await owner.$executeRawUnsafe(
        'DELETE FROM "Contact" WHERE "tenantId" = $1 AND email LIKE $2',
        tenantId,
        `${EMAIL_PREFIX}%@example.test`,
      );
      await owner.$disconnect();
    }
  });

  const server = () => app.getHttpServer();

  async function timedGet(
    path: string,
  ): Promise<{ ms: number; body: Record<string, any> }> {
    const started = process.hrtime.bigint();
    const response = await request(server()).get(path).set('x-perf-run', '1');
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (response.status !== 200) {
      throw new Error(
        `Expected 200 from ${path}, got ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return { ms, body: response.body };
  }

  it(`lists ${RECORD_TARGET.toLocaleString()} contacts in under ${BUDGET_MS}ms`, async () => {
    const path =
      '/workspace/modules/sales/contacts/records?page=1&pageSize=25&sort=lastName:asc';

    // Warm the pool, Prisma query compilation, and module resolution.
    for (let i = 0; i < 3; i += 1) {
      await timedGet(path);
    }

    const samples: number[] = [];
    let total = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const response = await timedGet(path);
      samples.push(response.ms);
      total = response.body?.meta?.total ?? 0;
    }

    const median = percentile(samples, 50);
    const p90 = percentile(samples, 90);

    console.log(
      `[perf] records list total=${total} samples=${samples
        .map((n) => n.toFixed(1))
        .join(
          ', ',
        )}ms median=${median.toFixed(1)}ms p90=${p90.toFixed(1)}ms max=${Math.max(...samples).toFixed(1)}ms`,
    );

    expect(total).toBeGreaterThanOrEqual(RECORD_TARGET);
    expect(median).toBeLessThan(BUDGET_MS);
    expect(p90).toBeLessThan(BUDGET_MS);
  });

  it(`searches a 10k+ contact table in under ${BUDGET_MS}ms`, async () => {
    const path =
      '/workspace/modules/sales/contacts/records?page=1&pageSize=25&search=Perf%20Contact%209999';

    for (let i = 0; i < 3; i += 1) {
      await timedGet(path);
    }

    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      samples.push((await timedGet(path)).ms);
    }

    const median = percentile(samples, 50);
    const p90 = percentile(samples, 90);

    console.log(
      `[perf] records search samples=${samples
        .map((n) => n.toFixed(1))
        .join(
          ', ',
        )}ms median=${median.toFixed(1)}ms p90=${p90.toFixed(1)}ms max=${Math.max(...samples).toFixed(1)}ms`,
    );

    expect(median).toBeLessThan(BUDGET_MS);
    expect(p90).toBeLessThan(BUDGET_MS);
  });
});
