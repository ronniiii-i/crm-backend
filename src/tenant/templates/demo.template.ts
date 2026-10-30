import { CLEAN_SLATE_TEMPLATE } from './clean-slate.template';
import { WorkspaceTemplate, WorkspaceTemplateKey } from './types';

/**
 * Acme demo: the same structure and configs as Clean Slate.
 *
 * The distinction is seed-only business data. Keeping the module shape
 * identical guarantees that demo and production workspaces render through the
 * same code paths; Stage 7 attaches the rich records from `prisma/seed`.
 */
export const DEMO_TEMPLATE: WorkspaceTemplate = {
  key: WorkspaceTemplateKey.DEMO,
  name: 'Acme Demo',
  description:
    'Clean Slate structure plus seed-only demo records and populated charts.',
  departments: CLEAN_SLATE_TEMPLATE.departments,
  roles: CLEAN_SLATE_TEMPLATE.roles,
  modules: CLEAN_SLATE_TEMPLATE.modules,
  includesDemoData: true,
};
