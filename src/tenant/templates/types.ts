import type {
  DefaultDepartment,
  DefaultModule,
  DefaultRole,
} from '../defaults';

/** The two provisioning shapes supported by Phase 3. */
export enum WorkspaceTemplateKey {
  CLEAN_SLATE = 'CLEAN_SLATE',
  DEMO = 'DEMO',
}

/**
 * A complete, self-contained blueprint for a new workspace.
 *
 * Templates are internal to provisioning: HTTP DTOs never accept a template
 * key. Demo templates are additionally gated by `allowDemoTemplate` and are
 * unreachable in production.
 */
export interface WorkspaceTemplate {
  key: WorkspaceTemplateKey;
  name: string;
  description: string;
  departments: DefaultDepartment[];
  roles: DefaultRole[];
  modules: DefaultModule[];
  /** Demo templates may be paired with seed-only business data. */
  includesDemoData: boolean;
}

/**
 * Internal provisioning options. Keep this out of controller DTOs: callers
 * that are not seed scripts must rely on the environment-based resolution.
 */
export interface ProvisionTenantOptions {
  template?: WorkspaceTemplateKey;
  /**
   * Explicit opt-in required to ask for the demo template. Only seed scripts
   * should set this; production resolution ignores it entirely.
   */
  allowDemoTemplate?: boolean;
}

export interface TemplateResolutionEnv {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  WORKSPACE_PROVISION_TEMPLATE?: string;
}
