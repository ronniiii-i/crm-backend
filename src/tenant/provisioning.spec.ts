import { ModuleType } from '@prisma/client';
import { CLEAN_SLATE_TEMPLATE, DEMO_TEMPLATE } from './templates';
import { buildModuleCreateManyData } from './tenant-provisioning.service';

const TENANT_ID = 'tenant-under-test';

const departmentIds = new Map(
  CLEAN_SLATE_TEMPLATE.departments.map((department, index) => [
    department.key,
    `dept-${index}`,
  ]),
);

describe('tenant provisioning module shape', () => {
  const rows = buildModuleCreateManyData(
    CLEAN_SLATE_TEMPLATE,
    TENANT_ID,
    departmentIds,
  );

  it('creates one module per template module', () => {
    expect(rows).toHaveLength(CLEAN_SLATE_TEMPLATE.modules.length);
  });

  it('persists renderer metadata and a versioned config for every module', () => {
    for (const row of rows) {
      expect(row.tenantId).toBe(TENANT_ID);
      expect(Object.values(ModuleType)).toContain(row.type);
      expect(row.config).toEqual(
        expect.objectContaining({ version: expect.any(Number) }),
      );
      expect(row.isActive).not.toBe(false);
    }
  });

  it('uses canonical dynamic paths for department modules', () => {
    const departmentRows = rows.filter((row) => row.departmentId);

    expect(departmentRows.length).toBeGreaterThan(0);
    for (const row of departmentRows) {
      expect(row.path).toMatch(/^\/dept\/[a-z_]+\/[a-z0-9-]+$/);
    }
  });

  it('keeps workspace modules on their existing apex paths', () => {
    const dashboard = rows.find((row) => row.key === 'dashboard');
    expect(dashboard?.path).toBe('/dashboard');
    expect(dashboard?.departmentId).toBeNull();
  });

  it('ships the new onboarding and accounting-ledger modules', () => {
    const onboarding = rows.find((row) => row.key === 'onboarding');
    const ledger = rows.find((row) => row.key === 'accounting-ledger');

    expect(onboarding).toMatchObject({
      type: ModuleType.FORM_BUILDER,
      targetEntity: null,
      path: '/dept/human_resources/onboarding',
    });
    expect(onboarding?.config).toEqual(
      expect.objectContaining({
        entity: null,
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'employeeEmail' }),
        ]),
      }),
    );

    expect(ledger).toMatchObject({
      type: ModuleType.DASHBOARD_VIEW,
      targetEntity: 'expenses',
      path: '/dept/accounting/accounting-ledger',
    });
    expect(ledger?.config).toEqual(
      expect.objectContaining({
        widgets: expect.arrayContaining([
          expect.objectContaining({ id: 'kpi-ledger-spend' }),
        ]),
      }),
    );
  });

  it('maps each renderer type to a target entity where the plan requires it', () => {
    const byKey = new Map(rows.map((row) => [row.key, row]));

    expect(byKey.get('invoices')).toMatchObject({
      type: ModuleType.DATA_TABLE,
      targetEntity: 'invoices',
    });
    expect(byKey.get('sales-pipeline')).toMatchObject({
      type: ModuleType.KANBAN_BOARD,
      targetEntity: 'deals',
    });
    expect(byKey.get('knowledge-base')).toMatchObject({
      type: ModuleType.DOCUMENT_HUB,
      targetEntity: null,
    });
    expect(byKey.get('financial-reports')).toMatchObject({
      type: ModuleType.DASHBOARD_VIEW,
      targetEntity: 'invoices',
    });
    expect(byKey.get('expense-tracking')).toMatchObject({
      type: ModuleType.FORM_BUILDER,
      targetEntity: 'expenses',
    });
  });

  it('provisions the same structural shape for the demo template', () => {
    const demoRows = buildModuleCreateManyData(
      DEMO_TEMPLATE,
      TENANT_ID,
      departmentIds,
    );

    expect(demoRows.map((row) => row.key).sort()).toEqual(
      rows.map((row) => row.key).sort(),
    );
  });

  it('rejects a module that references an unknown department', () => {
    expect(() =>
      buildModuleCreateManyData(CLEAN_SLATE_TEMPLATE, TENANT_ID, new Map()),
    ).toThrow(/unknown department/);
  });
});
