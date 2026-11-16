import { ModuleType } from '@prisma/client';
import {
  DashboardConfig,
  DocumentConfig,
  FormConfig,
  KanbanConfig,
  ModuleConfig,
  TableConfig,
} from '../workspace/types/module-config';
import { RoleSlug } from './defaults';

/**
 * Code-defined catalogue used by the department creation wizard and the
 * module provisioning endpoint.
 *
 * The client only ever sends template keys, never a renderer config, type or
 * entity name. Adding a template here is the only way to make it attachable.
 */
export interface DepartmentModuleTemplate {
  key: string;
  name: string;
  description: string;
  category: 'records' | 'people' | 'finance' | 'operations' | 'documents';
  type: ModuleType;
  targetEntity: string | null;
  icon: string;
  config: (deptKey: string) => ModuleConfig;
  recommendedRoles: RoleSlug[];
}

const table = (
  entity: string,
  columns: TableConfig['columns'],
  overrides: Partial<TableConfig> = {},
): TableConfig => ({
  version: 1,
  entity,
  columns,
  defaultSort: { field: 'createdAt', dir: 'desc' },
  pageSize: 25,
  searchFields: columns
    .filter((column) => column.filterable)
    .map((column) => column.field)
    .slice(0, 3),
  createEnabled: true,
  filters: [],
  ...overrides,
});

const column = (
  field: string,
  label: string,
  type: string,
  sortable = true,
  filterable = true,
): TableConfig['columns'][number] => ({
  field,
  label,
  type,
  sortable,
  filterable,
});

const DEAL_STAGES: KanbanConfig['columns'] = [
  { value: 'LEAD', label: 'Lead', color: 'slate' },
  { value: 'QUALIFIED', label: 'Qualified', color: 'blue' },
  { value: 'PROPOSAL', label: 'Proposal', color: 'violet' },
  { value: 'NEGOTIATION', label: 'Negotiation', color: 'amber' },
  { value: 'WON', label: 'Won', color: 'emerald' },
];

const dealsKanban = (): KanbanConfig => ({
  version: 1,
  entity: 'deals',
  statusField: 'status',
  columns: DEAL_STAGES,
  secondaryColumns: [{ value: 'LOST', label: 'Lost', color: 'rose' }],
  titleField: 'name',
  valueField: 'amount',
  assigneeField: 'userId',
  dueField: 'closeDate',
  allowCreate: true,
  allowMove: true,
});

const documentsHub = (): DocumentConfig => ({
  version: 1,
  categories: ['Policies', 'SOPs', 'Wiki', 'Templates'],
  defaultFormat: 'MARKDOWN',
  allowCreate: true,
  allowRichText: true,
});

const intakeForm = (): FormConfig => ({
  version: 1,
  entity: null,
  mode: 'create',
  fields: [
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      mapTo: 'customFields',
    },
    {
      name: 'details',
      label: 'Details',
      type: 'textarea',
      required: true,
      mapTo: 'customFields',
    },
  ],
  submitLabel: 'Submit request',
  successMessage: 'Your request was submitted.',
});

const departmentDashboard = (): DashboardConfig => ({
  version: 1,
  layout: 'grid',
  columns: 12,
  widgets: [
    {
      id: 'kpi-open-tasks',
      kind: 'stat',
      title: 'Open tasks',
      entity: 'tasks',
      aggregation: 'COUNT',
      field: 'id',
      timeframe: 'LAST_30_DAYS',
      filters: [],
      groupBy: null,
      format: 'number',
      color: 'blue',
      span: 4,
    },
    {
      id: 'kpi-ticket-volume',
      kind: 'stat',
      title: 'Tickets',
      entity: 'support_tickets',
      aggregation: 'COUNT',
      field: 'id',
      timeframe: 'LAST_30_DAYS',
      filters: [],
      groupBy: null,
      format: 'number',
      color: 'amber',
      span: 4,
    },
  ],
});

export const DEPARTMENT_MODULE_TEMPLATES: DepartmentModuleTemplate[] = [
  {
    key: 'contacts',
    name: 'Contacts',
    description: 'Searchable customer and prospect directory.',
    category: 'people',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'contacts',
    icon: 'BookUser',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () =>
      table('contacts', [
        column('firstName', 'First name', 'text'),
        column('lastName', 'Last name', 'text'),
        column('company', 'Company', 'text'),
        column('email', 'Email', 'text'),
        column('status', 'Status', 'badge'),
      ]),
  },
  {
    key: 'deals',
    name: 'Deals',
    description: 'Five-stage sales pipeline board.',
    category: 'records',
    type: ModuleType.KANBAN_BOARD,
    targetEntity: 'deals',
    icon: 'TrendingUp',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () => dealsKanban(),
  },
  {
    key: 'tasks',
    name: 'Tasks',
    description: 'Assignable work items with due dates.',
    category: 'operations',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'tasks',
    icon: 'CheckSquare',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () =>
      table('tasks', [
        column('title', 'Task', 'text'),
        column('status', 'Status', 'badge'),
        column('priority', 'Priority', 'badge'),
        column('dueDate', 'Due', 'date'),
      ]),
  },
  {
    key: 'tickets',
    name: 'Support tickets',
    description: 'Customer support queue with status and priority.',
    category: 'operations',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'support_tickets',
    icon: 'LifeBuoy',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () =>
      table('support_tickets', [
        column('subject', 'Subject', 'text'),
        column('status', 'Status', 'badge'),
        column('priority', 'Priority', 'badge'),
        column('createdAt', 'Created', 'date'),
      ]),
  },
  {
    key: 'documents',
    name: 'Documents',
    description: 'Markdown document hub for policies and SOPs.',
    category: 'documents',
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    icon: 'FileText',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () => documentsHub(),
  },
  {
    key: 'invoices',
    name: 'Invoices',
    description: 'Invoice ledger with currency-formatted amounts.',
    category: 'finance',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'invoices',
    icon: 'ReceiptText',
    recommendedRoles: ['tenant_admin', 'department_head'],
    config: () =>
      table('invoices', [
        column('invoiceNumber', 'Invoice', 'text'),
        column('amount', 'Amount', 'currency'),
        column('status', 'Status', 'badge'),
        column('dueDate', 'Due', 'date'),
      ]),
  },
  {
    key: 'expenses',
    name: 'Expenses',
    description: 'Department expense register.',
    category: 'finance',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'expenses',
    icon: 'Receipt',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead'],
    config: () =>
      table('expenses', [
        column('description', 'Description', 'text'),
        column('amount', 'Amount', 'currency'),
        column('category', 'Category', 'badge'),
        column('incurredAt', 'Incurred', 'date'),
      ]),
  },
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Shared stock catalogue with reorder thresholds.',
    category: 'operations',
    type: ModuleType.DATA_TABLE,
    targetEntity: 'inventory_items',
    icon: 'Boxes',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () =>
      table('inventory_items', [
        column('name', 'Item', 'text'),
        column('sku', 'SKU', 'text'),
        column('quantity', 'Quantity', 'number'),
        column('unit', 'Unit', 'text'),
        column('minStock', 'Minimum', 'number'),
      ]),
  },
  {
    key: 'request-form',
    name: 'Request form',
    description: 'Generic intake form for ad-hoc requests.',
    category: 'operations',
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    icon: 'ClipboardList',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () => intakeForm(),
  },
  {
    key: 'dashboard',
    name: 'Department dashboard',
    description: 'KPI overview for the department.',
    category: 'records',
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: null,
    icon: 'LayoutDashboard',
    recommendedRoles: ['tenant_admin', 'department_head', 'team_lead', 'staff'],
    config: () => departmentDashboard(),
  },
];

export const DEPARTMENT_MODULE_TEMPLATE_MAP: ReadonlyMap<
  string,
  DepartmentModuleTemplate
> = new Map(
  DEPARTMENT_MODULE_TEMPLATES.map((template) => [template.key, template]),
);

export function getDepartmentModuleTemplate(
  key: string,
): DepartmentModuleTemplate | undefined {
  return DEPARTMENT_MODULE_TEMPLATE_MAP.get(key);
}
