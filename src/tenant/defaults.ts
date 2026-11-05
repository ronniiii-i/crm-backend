import { ModuleType, PermissionType, RoleDataScope } from '@prisma/client';

/**
 * Default workspace configuration.
 *
 * The catalogue lives under `src` because tenant provisioning imports it at
 * runtime. `prisma/seed/defaults.ts` re-exports this file for seed scripts and
 * for callers that expect the documented seed path.
 */

export const ROLE_SLUGS = [
  'tenant_admin',
  'department_head',
  'team_lead',
  'staff',
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export interface DefaultDepartment {
  key: string;
  name: string;
  sortOrder: number;
}

export interface DefaultRole {
  slug: RoleSlug;
  name: string;
  description: string;
  rank: number;
  dataScope: RoleDataScope;
  isSystem: true;
  isTenantAdmin: boolean;
}

/** Loose, versioned renderer config stored on `modules.config`. */
export type ModuleConfig = Record<string, unknown> & { version: number };

export interface DefaultModule {
  key: string;
  name: string;
  path: string;
  icon?: string;
  group: string;
  order: number;
  departmentKey?: string;
  isNavigable: boolean;
  /** Primitive renderer used by the dynamic workspace route. */
  type: ModuleType;
  /** Entity key understood by the Stage 3 entity registry, if any. */
  targetEntity: string | null;
  /** Renderer configuration; always includes a schema `version`. */
  config: ModuleConfig;
  defaultPermissions: Record<RoleSlug, PermissionType[]>;
}

export const PERMISSION_TYPES: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
  PermissionType.DELETE,
];

const ALL_ACTIONS: PermissionType[] = [...PERMISSION_TYPES];
const VIEW_ONLY: PermissionType[] = [PermissionType.VIEW];
const DEPARTMENT_HEAD_ACTIONS: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
  PermissionType.DELETE,
];
const TEAM_LEAD_ACTIONS: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.EDIT,
];
const STAFF_ACTIONS: PermissionType[] = [PermissionType.VIEW];

/** Order of the eight system departments created for every workspace. */
export const DEFAULT_DEPARTMENTS: DefaultDepartment[] = [
  { key: 'administration', name: 'Administration', sortOrder: 10 },
  { key: 'human_resources', name: 'Human Resources', sortOrder: 20 },
  { key: 'sales', name: 'Sales', sortOrder: 30 },
  { key: 'operations', name: 'Operations', sortOrder: 40 },
  { key: 'finance', name: 'Finance', sortOrder: 50 },
  {
    key: 'information_technology',
    name: 'Information Technology',
    sortOrder: 60,
  },
  { key: 'customer_support', name: 'Customer Support', sortOrder: 70 },
  { key: 'accounting', name: 'Accounting', sortOrder: 80 },
];

/** The four immutable roles seeded into every workspace. */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    slug: 'tenant_admin',
    name: 'Tenant Admin',
    description: 'Full administration of this workspace.',
    rank: 1000,
    dataScope: RoleDataScope.TENANT,
    isSystem: true,
    isTenantAdmin: true,
  },
  {
    slug: 'department_head',
    name: 'Department Head',
    description: 'Manages one department and its people.',
    rank: 700,
    dataScope: RoleDataScope.DEPARTMENT,
    isSystem: true,
    isTenantAdmin: false,
  },
  {
    slug: 'team_lead',
    name: 'Team Lead',
    description: 'Leads a team inside a department.',
    rank: 400,
    dataScope: RoleDataScope.TEAM,
    isSystem: true,
    isTenantAdmin: false,
  },
  {
    slug: 'staff',
    name: 'Staff',
    description: 'Individual contributor with self-scoped access.',
    rank: 100,
    dataScope: RoleDataScope.SELF,
    isSystem: true,
    isTenantAdmin: false,
  },
];

type PermissionOverrides = Partial<Record<RoleSlug, PermissionType[]>>;

function defaultPermissions(
  departmentKey: string | undefined,
  overrides: PermissionOverrides = {},
): Record<RoleSlug, PermissionType[]> {
  const base: Record<RoleSlug, PermissionType[]> = departmentKey
    ? {
        tenant_admin: ALL_ACTIONS,
        department_head: DEPARTMENT_HEAD_ACTIONS,
        team_lead: TEAM_LEAD_ACTIONS,
        staff: STAFF_ACTIONS,
      }
    : {
        tenant_admin: ALL_ACTIONS,
        department_head: VIEW_ONLY,
        team_lead: VIEW_ONLY,
        staff: VIEW_ONLY,
      };

  return { ...base, ...overrides };
}

interface ModuleOptions {
  icon?: string;
  departmentKey?: string;
  isNavigable?: boolean;
  overrides?: PermissionOverrides;
  type?: ModuleType;
  targetEntity?: string | null;
  config?: ModuleConfig;
}

interface TableColumnConfig {
  field: string;
  label: string;
  type?: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: number;
}

interface FormFieldConfig {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'currency'
    | 'date'
    | 'select'
    | 'checkbox'
    | 'email';
  required?: boolean;
  options?: string[];
  mapTo?: 'column' | 'customFields';
}

interface KanbanColumnConfig {
  value: string;
  label: string;
  color: string;
}

function tableConfig(
  entity: string,
  columns: TableColumnConfig[],
  overrides: Record<string, unknown> = {},
): ModuleConfig {
  return {
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
  };
}

function kanbanConfig(
  entity: string,
  columns: KanbanColumnConfig[],
  overrides: Record<string, unknown> = {},
): ModuleConfig {
  return {
    version: 1,
    entity,
    statusField: 'status',
    columns,
    secondaryColumns: [],
    titleField: 'name',
    valueField: null,
    assigneeField: null,
    dueField: null,
    allowCreate: true,
    allowMove: true,
    ...overrides,
  };
}

function dashboardConfig(
  widgets: Array<Record<string, unknown>>,
): ModuleConfig {
  return {
    version: 1,
    layout: 'grid',
    columns: 12,
    widgets,
  };
}

function documentConfig(
  categories: string[],
  overrides: Record<string, unknown> = {},
): ModuleConfig {
  return {
    version: 1,
    categories,
    defaultFormat: 'MARKDOWN',
    allowCreate: true,
    allowRichText: true,
    ...overrides,
  };
}

function formConfig(
  entity: string | null,
  fields: FormFieldConfig[],
  submitLabel: string,
  successMessage: string,
): ModuleConfig {
  return {
    version: 1,
    entity,
    mode: 'create',
    fields,
    submitLabel,
    successMessage,
  };
}

function widget(
  id: string,
  kind: 'stat' | 'bar' | 'line' | 'pie',
  title: string,
  entity: string,
  aggregation: 'SUM' | 'AVG' | 'COUNT',
  field: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind,
    title,
    entity,
    aggregation,
    field,
    timeframe: 'LAST_30_DAYS',
    filters: [],
    groupBy: null,
    format: aggregation === 'COUNT' ? 'number' : 'currency',
    color: 'blue',
    span: 3,
    ...overrides,
  };
}

/** Columns shared by every DATA_TABLE module for a given entity. */
const TABLE_COLUMNS: Record<string, TableColumnConfig[]> = {
  invoices: [
    {
      field: 'invoiceNumber',
      label: 'Invoice',
      sortable: true,
      filterable: true,
      width: 160,
    },
    {
      field: 'customer.company',
      label: 'Customer',
      filterable: true,
    },
    { field: 'amount', label: 'Amount', type: 'currency', sortable: true },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'dueDate', label: 'Due date', type: 'date', sortable: true },
    { field: 'createdAt', label: 'Created', type: 'date', sortable: true },
  ],
  expenses: [
    { field: 'description', label: 'Description', filterable: true },
    { field: 'amount', label: 'Amount', type: 'currency', sortable: true },
    {
      field: 'category',
      label: 'Category',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'incurredAt', label: 'Incurred', type: 'date', sortable: true },
    { field: 'department.name', label: 'Department' },
  ],
  contacts: [
    { field: 'firstName', label: 'First name', filterable: true },
    { field: 'lastName', label: 'Last name', filterable: true },
    { field: 'email', label: 'Email', filterable: true },
    { field: 'company', label: 'Company', filterable: true },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
  ],
  deals: [
    { field: 'name', label: 'Deal', filterable: true },
    { field: 'contact.company', label: 'Customer' },
    { field: 'amount', label: 'Amount', type: 'currency', sortable: true },
    {
      field: 'status',
      label: 'Stage',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'closeDate', label: 'Close date', type: 'date', sortable: true },
    { field: 'assignedTo.name', label: 'Owner' },
  ],
  tasks: [
    { field: 'title', label: 'Task', filterable: true },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'priority', label: 'Priority', type: 'number', sortable: true },
    { field: 'dueDate', label: 'Due date', type: 'date', sortable: true },
    { field: 'project.name', label: 'Project' },
    { field: 'assignedTo.name', label: 'Assignee' },
  ],
  users: [
    { field: 'name', label: 'Name', filterable: true },
    { field: 'email', label: 'Email', filterable: true },
    { field: 'role.name', label: 'Role' },
    { field: 'department.name', label: 'Department' },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
  ],
  inventory_items: [
    { field: 'name', label: 'Item', filterable: true },
    { field: 'sku', label: 'SKU', filterable: true },
    { field: 'quantity', label: 'Quantity', type: 'number', sortable: true },
    { field: 'unit', label: 'Unit' },
    { field: 'minStock', label: 'Min stock', type: 'number', sortable: true },
    { field: 'location', label: 'Location', filterable: true },
  ],
  support_tickets: [
    { field: 'subject', label: 'Subject', filterable: true },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'priority', label: 'Priority', type: 'number', sortable: true },
    { field: 'createdBy.company', label: 'Customer' },
    { field: 'assignedTo.name', label: 'Assignee' },
    { field: 'slaDueDate', label: 'SLA due', type: 'date', sortable: true },
  ],
  attendance_records: [
    { field: 'date', label: 'Date', type: 'date', sortable: true },
    {
      field: 'status',
      label: 'Status',
      type: 'badge',
      sortable: true,
      filterable: true,
    },
    { field: 'user.name', label: 'Employee' },
  ],
};

const DEAL_STAGES: KanbanColumnConfig[] = [
  { value: 'LEAD', label: 'Lead', color: 'slate' },
  { value: 'QUALIFIED', label: 'Qualified', color: 'blue' },
  { value: 'PROPOSAL', label: 'Proposal', color: 'violet' },
  { value: 'NEGOTIATION', label: 'Negotiation', color: 'amber' },
  { value: 'WON', label: 'Won', color: 'emerald' },
];

const KANBAN_COLUMNS: Record<string, KanbanColumnConfig[]> = {
  deals: DEAL_STAGES,
  tasks: [
    { value: 'Todo', label: 'Todo', color: 'slate' },
    { value: 'In Progress', label: 'In Progress', color: 'blue' },
    { value: 'Review', label: 'Review', color: 'violet' },
    { value: 'Completed', label: 'Completed', color: 'emerald' },
  ],
  support_tickets: [
    { value: 'OPEN', label: 'Open', color: 'slate' },
    { value: 'IN_PROGRESS', label: 'In Progress', color: 'blue' },
    { value: 'RESOLVED', label: 'Resolved', color: 'emerald' },
    { value: 'CLOSED', label: 'Closed', color: 'rose' },
  ],
};

const DEFAULT_DOCUMENT_CATEGORIES = ['Policies', 'SOPs', 'Wiki', 'Templates'];

const EXPENSE_CATEGORIES = [
  'Travel',
  'Software',
  'Office',
  'Marketing',
  'Payroll',
  'Other',
];

interface ModuleRenderer {
  type: ModuleType;
  targetEntity: string | null;
  config?: ModuleConfig;
}

/**
 * Renderer metadata for every catalogue module.
 *
 * Department modules render through the dynamic `/dept/:dept/:module` route.
 * Workspace modules keep their existing pages and only need a compatible type
 * row so the ACL payload stays uniform.
 */
const MODULE_RENDERERS: Record<string, ModuleRenderer> = {
  // Workspace (existing pages; not routed through ModuleHost in Phase 3)
  dashboard: {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: null,
  },

  // Finance
  invoices: { type: ModuleType.DATA_TABLE, targetEntity: 'invoices' },
  payments: {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'invoices',
    config: tableConfig('invoices', TABLE_COLUMNS.invoices, {
      filters: [
        { field: 'status', label: 'Status', options: ['PAID', 'PENDING'] },
      ],
    }),
  },
  'expense-tracking': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: 'expenses',
    config: formConfig(
      'expenses',
      [
        {
          name: 'description',
          label: 'Description',
          type: 'text',
          required: true,
          mapTo: 'column',
        },
        {
          name: 'amount',
          label: 'Amount',
          type: 'currency',
          required: true,
          mapTo: 'column',
        },
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          required: true,
          options: EXPENSE_CATEGORIES,
          mapTo: 'column',
        },
        {
          name: 'incurredAt',
          label: 'Date incurred',
          type: 'date',
          required: true,
          mapTo: 'column',
        },
        {
          name: 'costCenter',
          label: 'Cost center',
          type: 'text',
          mapTo: 'customFields',
        },
      ],
      'Submit expense',
      'Expense submitted for approval.',
    ),
  },
  'budget-management': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'expenses',
    config: dashboardConfig([
      widget(
        'kpi-budget',
        'stat',
        'Total budget',
        'expenses',
        'SUM',
        'amount',
        {
          timeframe: 'ALL',
          color: 'blue',
          span: 4,
        },
      ),
      widget(
        'kpi-spent-mtd',
        'stat',
        'Spent this month',
        'expenses',
        'SUM',
        'amount',
        { timeframe: 'MTD', color: 'amber', span: 4 },
      ),
      widget(
        'kpi-budget-remaining',
        'stat',
        'Remaining',
        'expenses',
        'SUM',
        'amount',
        { timeframe: 'MTD', color: 'emerald', span: 4 },
      ),
      widget(
        'chart-budget-category',
        'pie',
        'Spend by category',
        'expenses',
        'SUM',
        'amount',
        {
          timeframe: 'LAST_90_DAYS',
          groupBy: 'category',
          span: 6,
        },
      ),
      widget(
        'chart-budget-department',
        'bar',
        'Spend by department',
        'expenses',
        'SUM',
        'amount',
        {
          timeframe: 'LAST_90_DAYS',
          groupBy: 'departmentId',
          span: 6,
        },
      ),
    ]),
  },
  'financial-reports': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'invoices',
    config: dashboardConfig([
      widget(
        'kpi-revenue',
        'stat',
        'Revenue (30d)',
        'invoices',
        'SUM',
        'amount',
        {
          span: 3,
        },
      ),
      widget(
        'kpi-expenses',
        'stat',
        'Expenses (30d)',
        'expenses',
        'SUM',
        'amount',
        { color: 'amber', span: 3 },
      ),
      widget(
        'chart-revenue-expenses',
        'line',
        'Revenue vs expenses',
        'invoices',
        'SUM',
        'amount',
        { timeframe: 'LAST_90_DAYS', span: 6 },
      ),
      widget(
        'chart-expense-mix',
        'pie',
        'Expense mix',
        'expenses',
        'SUM',
        'amount',
        { timeframe: 'LAST_90_DAYS', groupBy: 'category', span: 6 },
      ),
    ]),
  },

  // Information Technology
  'asset-management': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'inventory_items',
  },
  'ticketing-issue-tracking': {
    type: ModuleType.KANBAN_BOARD,
    targetEntity: 'support_tickets',
    config: kanbanConfig('support_tickets', KANBAN_COLUMNS.support_tickets, {
      titleField: 'subject',
      assigneeField: 'userId',
      dueField: 'slaDueDate',
      slaRules: [
        { priority: 1, hours: 24 },
        { priority: 2, hours: 8 },
        { priority: 3, hours: 4 },
      ],
    }),
  },
  'system-monitoring': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'support_tickets',
    config: dashboardConfig([
      widget(
        'kpi-open-tickets',
        'stat',
        'Open tickets',
        'support_tickets',
        'COUNT',
        'id',
        {
          timeframe: 'ALL',
          filters: [{ field: 'status', op: 'neq', value: 'CLOSED' }],
        },
      ),
      widget(
        'chart-ticket-volume',
        'line',
        'Ticket volume',
        'support_tickets',
        'COUNT',
        'id',
        { span: 6 },
      ),
      widget(
        'chart-tickets-priority',
        'bar',
        'Tickets by priority',
        'support_tickets',
        'COUNT',
        'id',
        { timeframe: 'ALL', groupBy: 'status', span: 6 },
      ),
    ]),
  },
  'software-licenses': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'inventory_items',
    config: tableConfig('inventory_items', TABLE_COLUMNS.inventory_items, {
      filters: [
        {
          field: 'customFields.category',
          label: 'License type',
          options: ['Perpetual', 'Subscription', 'Trial'],
        },
      ],
    }),
  },
  'support-requests': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: 'support_tickets',
    config: formConfig(
      'support_tickets',
      [
        {
          name: 'subject',
          label: 'Subject',
          type: 'text',
          required: true,
          mapTo: 'column',
        },
        {
          name: 'description',
          label: 'Describe the issue',
          type: 'textarea',
          required: true,
          mapTo: 'column',
        },
        {
          name: 'priority',
          label: 'Priority',
          type: 'select',
          required: true,
          options: ['1', '2', '3'],
          mapTo: 'column',
        },
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          options: ['Hardware', 'Software', 'Access', 'Network'],
          mapTo: 'customFields',
        },
      ],
      'Submit request',
      'Your request has been added to the queue.',
    ),
  },

  // Sales
  'leads-management': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'contacts',
    config: tableConfig('contacts', TABLE_COLUMNS.contacts, {
      filters: [{ field: 'status', label: 'Status', options: ['Lead'] }],
    }),
  },
  'opportunities-deals': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'deals',
  },
  contacts: { type: ModuleType.DATA_TABLE, targetEntity: 'contacts' },
  'sales-pipeline': {
    type: ModuleType.KANBAN_BOARD,
    targetEntity: 'deals',
    config: kanbanConfig('deals', DEAL_STAGES, {
      secondaryColumns: [{ value: 'LOST', label: 'Lost', color: 'rose' }],
      valueField: 'amount',
      assigneeField: 'userId',
      dueField: 'closeDate',
    }),
  },
  'quotes-proposals': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(['Quotes', 'Proposals', 'Contracts']),
  },
  'sales-reports': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'deals',
    config: dashboardConfig([
      widget(
        'kpi-pipeline-value',
        'stat',
        'Pipeline value',
        'deals',
        'SUM',
        'amount',
        { timeframe: 'ALL', span: 4 },
      ),
      widget(
        'kpi-won-deals',
        'stat',
        'Won deals (90d)',
        'deals',
        'COUNT',
        'id',
        {
          timeframe: 'LAST_90_DAYS',
          filters: [{ field: 'status', op: 'eq', value: 'WON' }],
          color: 'emerald',
          span: 4,
        },
      ),
      widget(
        'kpi-avg-deal',
        'stat',
        'Average deal size',
        'deals',
        'AVG',
        'amount',
        { timeframe: 'ALL', color: 'violet', span: 4 },
      ),
      widget(
        'chart-pipeline-stage',
        'bar',
        'Pipeline by stage',
        'deals',
        'SUM',
        'amount',
        { timeframe: 'ALL', groupBy: 'status', span: 12 },
      ),
    ]),
  },

  // Customer Support
  'support-tickets': {
    type: ModuleType.KANBAN_BOARD,
    targetEntity: 'support_tickets',
    config: kanbanConfig('support_tickets', KANBAN_COLUMNS.support_tickets, {
      titleField: 'subject',
      assigneeField: 'userId',
      dueField: 'slaDueDate',
    }),
  },
  'knowledge-base': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(['Guides', 'FAQs', 'Troubleshooting']),
  },
  'customer-feedback': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'rating',
          label: 'Rating (1-5)',
          type: 'number',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'feedback',
          label: 'Your feedback',
          type: 'textarea',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'contactEmail',
          label: 'Contact email',
          type: 'email',
          mapTo: 'customFields',
        },
      ],
      'Send feedback',
      'Thank you for your feedback.',
    ),
  },
  'sla-management': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(['SLA Policies', 'Escalation', 'Runbooks'], {
      slaRules: [
        { priority: 1, hours: 24 },
        { priority: 2, hours: 8 },
        { priority: 3, hours: 4 },
      ],
    }),
  },
  'live-chat-communication': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'message',
          label: 'Message',
          type: 'textarea',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'channel',
          label: 'Channel',
          type: 'select',
          required: true,
          options: ['Web', 'Email', 'Phone'],
          mapTo: 'customFields',
        },
      ],
      'Start conversation',
      'Your message has been queued.',
    ),
  },

  // Human Resources
  'employee-records': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'users',
  },
  'attendance-leave-management': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'attendance_records',
  },
  'recruitment-job-postings': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'title',
          label: 'Job title',
          type: 'text',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'employmentType',
          label: 'Employment type',
          type: 'select',
          required: true,
          options: ['Full-time', 'Part-time', 'Contract'],
          mapTo: 'customFields',
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          required: true,
          mapTo: 'customFields',
        },
      ],
      'Publish posting',
      'Job posting published.',
    ),
  },
  'performance-reviews': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'employeeEmail',
          label: 'Employee email',
          type: 'email',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'period',
          label: 'Review period',
          type: 'text',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'rating',
          label: 'Rating (1-5)',
          type: 'select',
          required: true,
          options: ['1', '2', '3', '4', '5'],
          mapTo: 'customFields',
        },
        {
          name: 'comments',
          label: 'Comments',
          type: 'textarea',
          mapTo: 'customFields',
        },
      ],
      'Submit review',
      'Review submitted.',
    ),
  },
  payroll: {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'expenses',
    config: dashboardConfig([
      widget(
        'kpi-payroll-spend',
        'stat',
        'Payroll spend (30d)',
        'expenses',
        'SUM',
        'amount',
        {
          filters: [{ field: 'category', op: 'eq', value: 'Payroll' }],
          span: 6,
        },
      ),
      widget(
        'chart-payroll-department',
        'bar',
        'Payroll by department',
        'expenses',
        'SUM',
        'amount',
        {
          timeframe: 'LAST_90_DAYS',
          groupBy: 'departmentId',
          filters: [{ field: 'category', op: 'eq', value: 'Payroll' }],
          span: 6,
        },
      ),
    ]),
  },
  onboarding: {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'employeeEmail',
          label: 'Employee email',
          type: 'email',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'startDate',
          label: 'Start date',
          type: 'date',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'itSetup',
          label: 'IT accounts and equipment ready',
          type: 'checkbox',
          mapTo: 'customFields',
        },
        {
          name: 'hrPaperwork',
          label: 'HR paperwork completed',
          type: 'checkbox',
          mapTo: 'customFields',
        },
        {
          name: 'securityTraining',
          label: 'Security training completed',
          type: 'checkbox',
          mapTo: 'customFields',
        },
        {
          name: 'teamIntro',
          label: 'Team introduction scheduled',
          type: 'checkbox',
          mapTo: 'customFields',
        },
        {
          name: 'notes',
          label: 'Notes',
          type: 'textarea',
          mapTo: 'customFields',
        },
      ],
      'Complete onboarding',
      'Onboarding checklist recorded.',
    ),
  },

  // Administration
  'document-management': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(DEFAULT_DOCUMENT_CATEGORIES),
  },
  'meeting-scheduler': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'title',
          label: 'Meeting title',
          type: 'text',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'scheduledAt',
          label: 'Date and time',
          type: 'date',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'attendees',
          label: 'Attendees',
          type: 'textarea',
          mapTo: 'customFields',
        },
        {
          name: 'agenda',
          label: 'Agenda',
          type: 'textarea',
          mapTo: 'customFields',
        },
      ],
      'Schedule meeting',
      'Meeting scheduled.',
    ),
  },
  'company-announcements': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(['Announcements', 'Newsletters']),
  },
  'compliance-policies': {
    type: ModuleType.DOCUMENT_HUB,
    targetEntity: null,
    config: documentConfig(['Policies', 'Compliance', 'Audits']),
  },
  'vendor-management': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'contacts',
  },

  // Operations
  'project-management': {
    type: ModuleType.KANBAN_BOARD,
    targetEntity: 'tasks',
    config: kanbanConfig('tasks', KANBAN_COLUMNS.tasks, {
      titleField: 'title',
      assigneeField: 'assignedToId',
      dueField: 'dueDate',
    }),
  },
  'inventory-management': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'inventory_items',
  },
  'workflow-automation': {
    type: ModuleType.FORM_BUILDER,
    targetEntity: null,
    config: formConfig(
      null,
      [
        {
          name: 'name',
          label: 'Automation name',
          type: 'text',
          required: true,
          mapTo: 'customFields',
        },
        {
          name: 'trigger',
          label: 'Trigger',
          type: 'select',
          required: true,
          options: ['Record created', 'Status changed', 'Scheduled'],
          mapTo: 'customFields',
        },
        {
          name: 'action',
          label: 'Action',
          type: 'textarea',
          required: true,
          mapTo: 'customFields',
        },
      ],
      'Save automation',
      'Automation saved.',
    ),
  },
  'resource-allocation': {
    type: ModuleType.DATA_TABLE,
    targetEntity: 'users',
  },
  'reporting-analytics': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'deals',
    config: dashboardConfig([
      widget(
        'kpi-revenue',
        'stat',
        'Revenue (30d)',
        'invoices',
        'SUM',
        'amount',
      ),
      widget(
        'kpi-expenses',
        'stat',
        'Expenses (30d)',
        'expenses',
        'SUM',
        'amount',
        {
          color: 'amber',
        },
      ),
      widget(
        'kpi-pipeline',
        'stat',
        'Pipeline value',
        'deals',
        'SUM',
        'amount',
        { timeframe: 'ALL', color: 'violet' },
      ),
      widget(
        'kpi-open-tickets',
        'stat',
        'Open tickets',
        'support_tickets',
        'COUNT',
        'id',
        { timeframe: 'ALL', color: 'rose' },
      ),
      widget(
        'chart-pipeline-stage',
        'bar',
        'Pipeline by stage',
        'deals',
        'SUM',
        'amount',
        { timeframe: 'ALL', groupBy: 'status', span: 6 },
      ),
      widget(
        'chart-ticket-volume',
        'line',
        'Ticket volume',
        'support_tickets',
        'COUNT',
        'id',
        { span: 6 },
      ),
    ]),
  },

  // Accounting
  'accounting-ledger': {
    type: ModuleType.DASHBOARD_VIEW,
    targetEntity: 'expenses',
    config: dashboardConfig([
      widget(
        'kpi-ledger-spend',
        'stat',
        'Total spend (30d)',
        'expenses',
        'SUM',
        'amount',
        { span: 4 },
      ),
      widget(
        'chart-ledger-category',
        'pie',
        'Spend by category',
        'expenses',
        'SUM',
        'amount',
        { timeframe: 'LAST_90_DAYS', groupBy: 'category', span: 4 },
      ),
      widget(
        'chart-ledger-department',
        'bar',
        'Spend by department',
        'expenses',
        'SUM',
        'amount',
        { timeframe: 'LAST_90_DAYS', groupBy: 'departmentId', span: 4 },
      ),
    ]),
  },
};

function defaultModuleConfig(
  type: ModuleType,
  targetEntity: string | null,
): ModuleConfig {
  switch (type) {
    case ModuleType.DATA_TABLE:
      return targetEntity
        ? tableConfig(targetEntity, TABLE_COLUMNS[targetEntity] ?? [])
        : { version: 1 };
    case ModuleType.KANBAN_BOARD:
      return targetEntity
        ? kanbanConfig(targetEntity, KANBAN_COLUMNS[targetEntity] ?? [])
        : { version: 1 };
    case ModuleType.DASHBOARD_VIEW:
      return dashboardConfig([]);
    case ModuleType.DOCUMENT_HUB:
      return documentConfig(DEFAULT_DOCUMENT_CATEGORIES);
    case ModuleType.FORM_BUILDER:
      return formConfig(targetEntity, [], 'Submit', 'Submitted.');
    default:
      return { version: 1 };
  }
}

function module(
  key: string,
  name: string,
  path: string,
  group: string,
  order: number,
  options: ModuleOptions = {},
): DefaultModule {
  const { icon, departmentKey, isNavigable = false, overrides = {} } = options;
  const renderer = MODULE_RENDERERS[key];
  const type = options.type ?? renderer?.type ?? ModuleType.DATA_TABLE;
  const targetEntity =
    options.targetEntity !== undefined
      ? options.targetEntity
      : (renderer?.targetEntity ?? null);
  const config =
    options.config ??
    renderer?.config ??
    defaultModuleConfig(type, targetEntity);

  return {
    key,
    name,
    // Department modules always use the canonical dynamic route, regardless
    // of the legacy path passed by older catalogue entries.
    path: departmentKey ? `/dept/${departmentKey}/${key}` : path,
    icon,
    group,
    order,
    departmentKey,
    isNavigable,
    type,
    targetEntity,
    config,
    defaultPermissions: defaultPermissions(departmentKey, overrides),
  };
}

/**
 * Full module catalogue.
 *
 * Only modules backed by real Phase 2 pages are navigable. Operational modules
 * stay in the catalogue so the permissions matrix can grant their future
 * capabilities without creating dead sidebar links.
 */
export const DEFAULT_MODULES: DefaultModule[] = [
  // Workspace ---------------------------------------------------------------
  module('dashboard', 'Dashboard', '/dashboard', 'Workspace', 1, {
    icon: 'LayoutDashboard',
    isNavigable: true,
  }),
  module('departments', 'Departments', '/departments', 'Workspace', 2, {
    icon: 'Building2',
    isNavigable: true,
  }),
  module(
    'user-management',
    'User Management',
    '/user-management',
    'Workspace',
    3,
    { icon: 'Users', isNavigable: true },
  ),
  module('settings', 'Settings', '/settings', 'Workspace', 4, {
    icon: 'Settings',
    isNavigable: true,
  }),
  module(
    'invitations',
    'Invitations',
    '/user-management?tab=invitations',
    'Workspace',
    5,
    {
      icon: 'MailPlus',
      overrides: {
        department_head: [PermissionType.VIEW, PermissionType.CREATE],
        team_lead: [],
        staff: [],
      },
    },
  ),
  module('roles', 'Roles & Permissions', '/settings/roles', 'Workspace', 6, {
    icon: 'ShieldCheck',
  }),
  module('billing', 'Billing', '/settings/billing', 'Workspace', 7, {
    icon: 'CreditCard',
    overrides: {
      department_head: [],
      team_lead: [],
      staff: [],
    },
  }),
  module('notifications', 'Notifications', '/notifications', 'Workspace', 8, {
    icon: 'Bell',
  }),

  // Finance -----------------------------------------------------------------
  module('invoices', 'Invoices', '/finance/invoices', 'Finance', 10, {
    icon: 'FileText',
    departmentKey: 'finance',
  }),
  module('payments', 'Payments', '/finance/payments', 'Finance', 11, {
    icon: 'CreditCard',
    departmentKey: 'finance',
  }),
  module(
    'expense-tracking',
    'Expense Tracking',
    '/finance/expense-tracking',
    'Finance',
    12,
    { icon: 'Receipt', departmentKey: 'finance' },
  ),
  module(
    'budget-management',
    'Budget Management',
    '/finance/budget-management',
    'Finance',
    13,
    { icon: 'PiggyBank', departmentKey: 'finance' },
  ),
  module(
    'financial-reports',
    'Financial Reports',
    '/finance/financial-reports',
    'Finance',
    14,
    { icon: 'BarChart2', departmentKey: 'finance' },
  ),

  // Information Technology -------------------------------------------------
  module(
    'asset-management',
    'Asset Management',
    '/it/asset-management',
    'IT',
    20,
    { icon: 'Monitor', departmentKey: 'information_technology' },
  ),
  module(
    'ticketing-issue-tracking',
    'Issue Tracking',
    '/it/ticketing-issue-tracking',
    'IT',
    21,
    { icon: 'Bug', departmentKey: 'information_technology' },
  ),
  module(
    'system-monitoring',
    'System Monitoring',
    '/it/system-monitoring',
    'IT',
    22,
    { icon: 'Activity', departmentKey: 'information_technology' },
  ),
  module(
    'software-licenses',
    'Software Licenses',
    '/it/software-licenses',
    'IT',
    23,
    { icon: 'KeyRound', departmentKey: 'information_technology' },
  ),
  module(
    'support-requests',
    'Support Requests',
    '/it/support-requests',
    'IT',
    24,
    { icon: 'LifeBuoy', departmentKey: 'information_technology' },
  ),

  // Sales -------------------------------------------------------------------
  module('leads-management', 'Leads', '/sales/leads-management', 'Sales', 30, {
    icon: 'UserPlus',
    departmentKey: 'sales',
  }),
  module(
    'opportunities-deals',
    'Opportunities & Deals',
    '/sales/opportunities-deals',
    'Sales',
    31,
    { icon: 'TrendingUp', departmentKey: 'sales' },
  ),
  module('contacts', 'Contacts', '/sales/contacts', 'Sales', 32, {
    icon: 'BookUser',
    departmentKey: 'sales',
  }),
  module(
    'sales-pipeline',
    'Sales Pipeline',
    '/sales/sales-pipeline',
    'Sales',
    33,
    { icon: 'FolderKanban', departmentKey: 'sales' },
  ),
  module(
    'quotes-proposals',
    'Quotes & Proposals',
    '/sales/quotes-proposals',
    'Sales',
    34,
    { icon: 'ClipboardList', departmentKey: 'sales' },
  ),
  module(
    'sales-reports',
    'Sales Reports',
    '/sales/sales-reports',
    'Sales',
    35,
    { icon: 'LineChart', departmentKey: 'sales' },
  ),

  // Customer Support --------------------------------------------------------
  module(
    'support-tickets',
    'Support Tickets',
    '/customer-support/support-tickets',
    'Customer Support',
    40,
    { icon: 'Ticket', departmentKey: 'customer_support' },
  ),
  module(
    'knowledge-base',
    'Knowledge Base',
    '/customer-support/knowledge-base',
    'Customer Support',
    41,
    { icon: 'BookOpen', departmentKey: 'customer_support' },
  ),
  module(
    'customer-feedback',
    'Customer Feedback',
    '/customer-support/customer-feedback',
    'Customer Support',
    42,
    { icon: 'MessageSquare', departmentKey: 'customer_support' },
  ),
  module(
    'sla-management',
    'SLA Management',
    '/customer-support/sla-management',
    'Customer Support',
    43,
    { icon: 'ShieldCheck', departmentKey: 'customer_support' },
  ),
  module(
    'live-chat-communication',
    'Live Chat',
    '/customer-support/live-chat-communication',
    'Customer Support',
    44,
    { icon: 'MessagesSquare', departmentKey: 'customer_support' },
  ),

  // Human Resources ---------------------------------------------------------
  module(
    'employee-records',
    'Employee Records',
    '/hr/employee-records',
    'Human Resources',
    50,
    { icon: 'IdCard', departmentKey: 'human_resources' },
  ),
  module(
    'attendance-leave-management',
    'Attendance & Leave',
    '/hr/attendance-leave-management',
    'Human Resources',
    51,
    { icon: 'CalendarCheck', departmentKey: 'human_resources' },
  ),
  module(
    'recruitment-job-postings',
    'Recruitment',
    '/hr/recruitment-job-postings',
    'Human Resources',
    52,
    { icon: 'BriefcaseBusiness', departmentKey: 'human_resources' },
  ),
  module(
    'performance-reviews',
    'Performance Reviews',
    '/hr/performance-reviews',
    'Human Resources',
    53,
    { icon: 'Star', departmentKey: 'human_resources' },
  ),
  module('payroll', 'Payroll', '/hr/payroll', 'Human Resources', 54, {
    icon: 'Banknote',
    departmentKey: 'human_resources',
  }),
  module(
    'onboarding',
    'Onboarding',
    '/dept/human_resources/onboarding',
    'Human Resources',
    55,
    { icon: 'ListChecks', departmentKey: 'human_resources' },
  ),

  // Administration ----------------------------------------------------------
  module(
    'document-management',
    'Document Management',
    '/administration/document-management',
    'Administration',
    60,
    { icon: 'FolderOpen', departmentKey: 'administration' },
  ),
  module(
    'meeting-scheduler',
    'Meeting Scheduler',
    '/administration/meeting-scheduler',
    'Administration',
    61,
    { icon: 'CalendarDays', departmentKey: 'administration' },
  ),
  module(
    'company-announcements',
    'Announcements',
    '/administration/company-announcements',
    'Administration',
    62,
    { icon: 'Megaphone', departmentKey: 'administration' },
  ),
  module(
    'compliance-policies',
    'Compliance & Policies',
    '/administration/compliance-policies',
    'Administration',
    63,
    { icon: 'Scale', departmentKey: 'administration' },
  ),
  module(
    'vendor-management',
    'Vendor Management',
    '/administration/vendor-management',
    'Administration',
    64,
    { icon: 'Handshake', departmentKey: 'administration' },
  ),

  // Operations --------------------------------------------------------------
  module(
    'project-management',
    'Project Management',
    '/operations/project-management',
    'Operations',
    70,
    { icon: 'Clipboard', departmentKey: 'operations' },
  ),
  module(
    'inventory-management',
    'Inventory Management',
    '/operations/inventory-management',
    'Operations',
    71,
    { icon: 'Boxes', departmentKey: 'operations' },
  ),
  module(
    'workflow-automation',
    'Workflow Automation',
    '/operations/workflow-automation',
    'Operations',
    72,
    { icon: 'Settings2', departmentKey: 'operations' },
  ),
  module(
    'resource-allocation',
    'Resource Allocation',
    '/operations/resource-allocation',
    'Operations',
    73,
    { icon: 'Users', departmentKey: 'operations' },
  ),
  module(
    'reporting-analytics',
    'Reporting & Analytics',
    '/operations/reporting-analytics',
    'Operations',
    74,
    { icon: 'PieChart', departmentKey: 'operations' },
  ),

  // Accounting --------------------------------------------------------------
  module(
    'accounting-ledger',
    'Accounting Ledger',
    '/dept/accounting/accounting-ledger',
    'Accounting',
    80,
    { icon: 'BookOpenCheck', departmentKey: 'accounting' },
  ),
];

export const DEFAULT_TRIAL_DAYS = 14;
