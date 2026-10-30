import { CLEAN_SLATE_TEMPLATE } from './clean-slate.template';
import { DEMO_TEMPLATE } from './demo.template';
import {
  ProvisionTenantOptions,
  TemplateResolutionEnv,
  WorkspaceTemplate,
  WorkspaceTemplateKey,
} from './types';

export * from './types';
export { CLEAN_SLATE_TEMPLATE } from './clean-slate.template';
export { DEMO_TEMPLATE } from './demo.template';

export const WORKSPACE_TEMPLATES: Record<
  WorkspaceTemplateKey,
  WorkspaceTemplate
> = {
  [WorkspaceTemplateKey.CLEAN_SLATE]: CLEAN_SLATE_TEMPLATE,
  [WorkspaceTemplateKey.DEMO]: DEMO_TEMPLATE,
};

/**
 * Resolve the template for a provisioning call.
 *
 * Rules (from PHASE3_IMPLEMENTATION_PLAN.md §8.1):
 *  - Production always returns Clean Slate, even if an env var asks for demo.
 *  - An explicit demo request requires `allowDemoTemplate`, so API callers can
 *    never reach it accidentally.
 *  - Outside production, `WORKSPACE_PROVISION_TEMPLATE=demo` opts in.
 *  - Everything else defaults to Clean Slate.
 */
export function resolveWorkspaceTemplateKey(
  options: ProvisionTenantOptions = {},
  env: TemplateResolutionEnv = process.env,
): WorkspaceTemplateKey {
  if (env.NODE_ENV === 'production') {
    return WorkspaceTemplateKey.CLEAN_SLATE;
  }

  if (options.template === WorkspaceTemplateKey.DEMO) {
    if (options.allowDemoTemplate !== true) {
      throw new Error(
        'Demo provisioning requires allowDemoTemplate=true and is reserved for seed scripts.',
      );
    }
    return WorkspaceTemplateKey.DEMO;
  }

  if (options.template === WorkspaceTemplateKey.CLEAN_SLATE) {
    return WorkspaceTemplateKey.CLEAN_SLATE;
  }

  if (
    env.WORKSPACE_PROVISION_TEMPLATE?.trim().toLowerCase() ===
    WorkspaceTemplateKey.DEMO.toLowerCase()
  ) {
    return WorkspaceTemplateKey.DEMO;
  }

  return WorkspaceTemplateKey.CLEAN_SLATE;
}

export function getWorkspaceTemplate(
  key: WorkspaceTemplateKey,
): WorkspaceTemplate {
  const template = WORKSPACE_TEMPLATES[key];
  if (!template) {
    throw new Error(`Unknown workspace template "${key}".`);
  }
  return template;
}

export function resolveWorkspaceTemplate(
  options: ProvisionTenantOptions = {},
  env: TemplateResolutionEnv = process.env,
): WorkspaceTemplate {
  return getWorkspaceTemplate(resolveWorkspaceTemplateKey(options, env));
}
