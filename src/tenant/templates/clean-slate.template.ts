import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_MODULES,
  DEFAULT_ROLES,
} from '../defaults';
import { WorkspaceTemplate, WorkspaceTemplateKey } from './types';

/**
 * Clean Slate: the production default.
 *
 * Departments, roles, modules, permission grants, and renderer configs are
 * present, but no business records exist. Every list renders its zero-state.
 */
export const CLEAN_SLATE_TEMPLATE: WorkspaceTemplate = {
  key: WorkspaceTemplateKey.CLEAN_SLATE,
  name: 'Clean Slate',
  description:
    'Full workspace structure and renderer configuration with zero business records.',
  departments: DEFAULT_DEPARTMENTS.map((department) => ({ ...department })),
  roles: DEFAULT_ROLES.map((role) => ({ ...role })),
  modules: DEFAULT_MODULES.map((module) => ({
    ...module,
    config: { ...module.config },
    defaultPermissions: {
      tenant_admin: [...module.defaultPermissions.tenant_admin],
      department_head: [...module.defaultPermissions.department_head],
      team_lead: [...module.defaultPermissions.team_lead],
      staff: [...module.defaultPermissions.staff],
    },
  })),
  includesDemoData: false,
};
