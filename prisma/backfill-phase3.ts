// prisma/backfill-phase3.ts
//
// One-off, idempotent backfill for the Phase 3 dynamic composition engine.
//
// Prisma migrations create the renderer columns with safe defaults. This
// script makes the data authoritative for existing tenants:
//
//   * modules.type / modules.targetEntity from the catalogue below
//   * canonical paths: /dept/<departmentKey>/<moduleKey>
//   * department modules become navigable
//
// It intentionally does NOT write module config JSON. Stage 2 applies the
// Clean Slate config template through the template registry, which keeps the
// backfill and the provisioning path using a single source of truth.
//
// Usage:
//   npm run db:backfill:phase3
//   npm run db:backfill:phase3 -- --dry-run
//
// Uses the owner connection (DIRECT_URL) because it touches every tenant and
// must bypass RLS. The runtime crm_app role never runs this script.
import 'dotenv/config';
import { ModuleType, Prisma, PrismaClient } from '@prisma/client';

interface ModuleMapping {
  type: ModuleType;
  targetEntity: string | null;
}

const MODULE_MAP: Record<string, ModuleMapping> = {
  // Workspace
  dashboard: { type: ModuleType.DASHBOARD_VIEW, targetEntity: null },
  departments: { type: ModuleType.DATA_TABLE, targetEntity: 'users' },
  'user-management': { type: ModuleType.DATA_TABLE, targetEntity: 'users' },
  settings: { type: ModuleType.DATA_TABLE, targetEntity: null },
  invitations: { type: ModuleType.DATA_TABLE, targetEntity: null },
  roles: { type: ModuleType.DATA_TABLE, targetEntity: null },
  billing: { type: ModuleType.DATA_TABLE, targetEntity: null },
  notifications: { type: ModuleType.DATA_TABLE, targetEntity: null },

  // Finance
  invoices: { type: ModuleType.DATA_TABLE, targetEntity: 'invoices' },
  payments: { type: ModuleType.DATA_TABLE, targetEntity: 'invoices' },
  'expense-tracking': { type: ModuleType.FORM_BUILDER, targetEntity: 'expenses' },
  'budget-management': { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'expenses' },
  'financial-reports': { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'invoices' },

  // Information Technology
  'asset-management': { type: ModuleType.DATA_TABLE, targetEntity: 'inventory_items' },
  'ticketing-issue-tracking': { type: ModuleType.KANBAN_BOARD, targetEntity: 'support_tickets' },
  'system-monitoring': { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'support_tickets' },
  'software-licenses': { type: ModuleType.DATA_TABLE, targetEntity: 'inventory_items' },
  'support-requests': { type: ModuleType.FORM_BUILDER, targetEntity: 'support_tickets' },

  // Sales
  'leads-management': { type: ModuleType.DATA_TABLE, targetEntity: 'contacts' },
  'opportunities-deals': { type: ModuleType.DATA_TABLE, targetEntity: 'deals' },
  contacts: { type: ModuleType.DATA_TABLE, targetEntity: 'contacts' },
  'sales-pipeline': { type: ModuleType.KANBAN_BOARD, targetEntity: 'deals' },
  'quotes-proposals': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'sales-reports': { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'deals' },

  // Customer Support
  'support-tickets': { type: ModuleType.KANBAN_BOARD, targetEntity: 'support_tickets' },
  'knowledge-base': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'customer-feedback': { type: ModuleType.FORM_BUILDER, targetEntity: null },
  'sla-management': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'live-chat-communication': { type: ModuleType.FORM_BUILDER, targetEntity: null },

  // Human Resources
  'employee-records': { type: ModuleType.DATA_TABLE, targetEntity: 'users' },
  'attendance-leave-management': { type: ModuleType.DATA_TABLE, targetEntity: 'attendance_records' },
  'recruitment-job-postings': { type: ModuleType.FORM_BUILDER, targetEntity: null },
  'performance-reviews': { type: ModuleType.FORM_BUILDER, targetEntity: null },
  payroll: { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'expenses' },

  // Administration
  'document-management': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'meeting-scheduler': { type: ModuleType.FORM_BUILDER, targetEntity: null },
  'company-announcements': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'compliance-policies': { type: ModuleType.DOCUMENT_HUB, targetEntity: null },
  'vendor-management': { type: ModuleType.DATA_TABLE, targetEntity: 'contacts' },

  // Operations
  'project-management': { type: ModuleType.KANBAN_BOARD, targetEntity: 'tasks' },
  'inventory-management': { type: ModuleType.DATA_TABLE, targetEntity: 'inventory_items' },
  'workflow-automation': { type: ModuleType.FORM_BUILDER, targetEntity: null },
  'resource-allocation': { type: ModuleType.DATA_TABLE, targetEntity: 'users' },
  'reporting-analytics': { type: ModuleType.DASHBOARD_VIEW, targetEntity: 'deals' },
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
    },
  });
}

export async function backfillPhase3(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {},
): Promise<{ scanned: number; updated: number; unknownKeys: string[] }> {
  const dryRun = options.dryRun === true;
  const modules = await prisma.module.findMany({
    select: {
      id: true,
      key: true,
      path: true,
      type: true,
      targetEntity: true,
      isNavigable: true,
      departmentId: true,
      department: { select: { key: true } },
    },
  });

  let updated = 0;
  const unknownKeys = new Set<string>();

  for (const module of modules) {
    const mapping = MODULE_MAP[module.key];
    if (!mapping) {
      unknownKeys.add(module.key);
    }

    const canonicalPath = module.department
      ? `/dept/${module.department.key}/${module.key}`
      : module.path;

    const data: Prisma.ModuleUncheckedUpdateInput = {};

    if (mapping && module.type !== mapping.type) {
      data.type = mapping.type;
    }
    if (mapping && module.targetEntity !== mapping.targetEntity) {
      data.targetEntity = mapping.targetEntity;
    }
    if (canonicalPath !== module.path) {
      data.path = canonicalPath;
    }
    if (module.departmentId && !module.isNavigable) {
      data.isNavigable = true;
    }

    if (Object.keys(data).length === 0) continue;

    updated += 1;
    if (dryRun) {
      console.log(
        `[dry-run] module ${module.key}: ${JSON.stringify(
          Object.keys(data).reduce<Record<string, unknown>>((acc, field) => {
            acc[field] = (data as Record<string, unknown>)[field];
            return acc;
          }, {}),
        )}`,
      );
      continue;
    }

    await prisma.module.update({ where: { id: module.id }, data });
  }

  return { scanned: modules.length, updated, unknownKeys: [...unknownKeys] };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createPrismaClient();

  try {
    const result = await backfillPhase3(prisma, { dryRun });
    console.log(
      `${dryRun ? 'Dry run' : 'Backfill'} complete: ` +
        `${result.scanned} modules scanned, ${result.updated} updated.`,
    );
    if (result.unknownKeys.length > 0) {
      console.warn(
        `Modules without a Phase 3 mapping (left untouched): ${result.unknownKeys.join(', ')}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Phase 3 backfill failed:', error);
    process.exitCode = 1;
  });
}
