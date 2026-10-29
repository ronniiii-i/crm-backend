import { PermissionType, RoleDataScope } from '@prisma/client';

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

export interface DefaultModule {
  key: string;
  name: string;
  path: string;
  icon?: string;
  group: string;
  order: number;
  departmentKey?: string;
  isNavigable: boolean;
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

  return {
    key,
    name,
    path,
    icon,
    group,
    order,
    departmentKey,
    isNavigable,
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
];

export const DEFAULT_TRIAL_DAYS = 14;
