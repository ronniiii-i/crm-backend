import {
  CLEAN_SLATE_TEMPLATE,
  DEMO_TEMPLATE,
  WorkspaceTemplateKey,
  resolveWorkspaceTemplate,
  resolveWorkspaceTemplateKey,
} from './index';

describe('workspace template resolution', () => {
  it('always resolves Clean Slate in production, even with demo overrides', () => {
    expect(
      resolveWorkspaceTemplateKey(
        {
          template: WorkspaceTemplateKey.DEMO,
          allowDemoTemplate: true,
        },
        {
          NODE_ENV: 'production',
          WORKSPACE_PROVISION_TEMPLATE: 'demo',
        },
      ),
    ).toBe(WorkspaceTemplateKey.CLEAN_SLATE);

    expect(
      resolveWorkspaceTemplate(
        { template: WorkspaceTemplateKey.DEMO, allowDemoTemplate: true },
        { NODE_ENV: 'production', WORKSPACE_PROVISION_TEMPLATE: 'demo' },
      ),
    ).toBe(CLEAN_SLATE_TEMPLATE);
  });

  it('requires an explicit opt-in for the demo template', () => {
    expect(() =>
      resolveWorkspaceTemplateKey(
        { template: WorkspaceTemplateKey.DEMO },
        { NODE_ENV: 'development' },
      ),
    ).toThrow(/allowDemoTemplate/);
  });

  it('allows seed callers to request the demo template outside production', () => {
    expect(
      resolveWorkspaceTemplateKey(
        { template: WorkspaceTemplateKey.DEMO, allowDemoTemplate: true },
        { NODE_ENV: 'test' },
      ),
    ).toBe(WorkspaceTemplateKey.DEMO);
  });

  it('honours WORKSPACE_PROVISION_TEMPLATE=demo outside production', () => {
    expect(
      resolveWorkspaceTemplateKey(
        {},
        { NODE_ENV: 'development', WORKSPACE_PROVISION_TEMPLATE: 'demo' },
      ),
    ).toBe(WorkspaceTemplateKey.DEMO);
  });

  it('defaults to Clean Slate', () => {
    expect(resolveWorkspaceTemplateKey({}, { NODE_ENV: 'development' })).toBe(
      WorkspaceTemplateKey.CLEAN_SLATE,
    );
    expect(
      resolveWorkspaceTemplateKey({}, { WORKSPACE_PROVISION_TEMPLATE: 'nope' }),
    ).toBe(WorkspaceTemplateKey.CLEAN_SLATE);
  });

  it('exposes both templates with the expected demo flag', () => {
    expect(CLEAN_SLATE_TEMPLATE.includesDemoData).toBe(false);
    expect(DEMO_TEMPLATE.includesDemoData).toBe(true);
    expect(DEMO_TEMPLATE.modules).toBe(CLEAN_SLATE_TEMPLATE.modules);
  });
});
