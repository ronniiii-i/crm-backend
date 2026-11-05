import {
  DealStatus,
  DocumentFormat,
  DocumentStatus,
  Prisma,
  PrismaClient,
  TicketStatus,
} from '@prisma/client';
import {
  DEMO_TEMPLATE,
  WorkspaceTemplateKey,
} from '../../../src/tenant/templates';
import {
  ensureProvisionedTenant,
  ensureTemplateStructure,
  ensureTeamMember,
  findOrCreateTeam,
  refreshTenantSeatCount,
  upsertSeedUser,
} from './structure';

/**
 * Acme Corp: the rich demo workspace.
 *
 * The tenant always has the same structure as Clean Slate; this file adds the
 * demo users and business records. Every write is a keyed upsert (or a
 * find-first/update) so re-running `db:seed` never duplicates records.
 */

export const ACME_TENANT = {
  slug: 'acme',
  name: 'Acme Corp',
  ownerEmail: 'admin@acme.test',
  ownerName: 'Avery Admin',
  template: WorkspaceTemplateKey.DEMO,
} as const;

interface AcmeUserSeed {
  email: string;
  name: string;
  roleSlug: string;
  departmentKey?: string;
}

const ACME_USERS: AcmeUserSeed[] = [
  { email: 'admin@acme.test', name: 'Avery Admin', roleSlug: 'tenant_admin' },
  {
    email: 'finance.hod@acme.test',
    name: 'Finley Hart',
    roleSlug: 'department_head',
    departmentKey: 'finance',
  },
  {
    email: 'sales.hod@acme.test',
    name: 'Harper Quinn',
    roleSlug: 'department_head',
    departmentKey: 'sales',
  },
  {
    email: 'hr.hod@acme.test',
    name: 'Hollis Bennett',
    roleSlug: 'department_head',
    departmentKey: 'human_resources',
  },
  {
    email: 'it.hod@acme.test',
    name: 'Ira Novak',
    roleSlug: 'department_head',
    departmentKey: 'information_technology',
  },
  {
    email: 'sales.lead@acme.test',
    name: 'Skyler Lane',
    roleSlug: 'team_lead',
    departmentKey: 'sales',
  },
  {
    email: 'staff@acme.test',
    name: 'Sam Reed',
    roleSlug: 'staff',
    departmentKey: 'sales',
  },
  {
    email: 'ops.staff@acme.test',
    name: 'Owen Price',
    roleSlug: 'staff',
    departmentKey: 'operations',
  },
  {
    email: 'support.staff@acme.test',
    name: 'Sage Moreno',
    roleSlug: 'staff',
    departmentKey: 'customer_support',
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setTime(date.getTime() - days * DAY_MS);
  return date;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setTime(date.getTime() + days * DAY_MS);
  return date;
}

function monthsAgo(months: number, day: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  date.setDate(Math.min(day, 28));
  return date;
}

interface ContactSeed {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  status: string;
  ownerEmail: string;
  tags: string[];
  notes: string;
}

const CONTACTS: ContactSeed[] = [
  {
    key: 'northwind',
    firstName: 'Alicia',
    lastName: 'Turner',
    email: 'alicia.turner@northwind.test',
    phone: '+1-555-0101',
    company: 'Northwind Traders',
    jobTitle: 'VP Operations',
    status: 'Customer',
    ownerEmail: 'sales.hod@acme.test',
    tags: ['enterprise', 'renewal'],
    notes: 'Annual platform expansion; procurement cycle runs in Q4.',
  },
  {
    key: 'globex',
    firstName: 'Marcus',
    lastName: 'Webb',
    email: 'marcus.webb@globex.test',
    phone: '+1-555-0102',
    company: 'Globex Corporation',
    jobTitle: 'Director of IT',
    status: 'Customer',
    ownerEmail: 'sales.hod@acme.test',
    tags: ['enterprise', 'security'],
    notes: 'Security review required before every renewal.',
  },
  {
    key: 'initech',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya.nair@initech.test',
    phone: '+1-555-0103',
    company: 'Initech',
    jobTitle: 'Head of Automation',
    status: 'Qualified',
    ownerEmail: 'sales.lead@acme.test',
    tags: ['workflow', 'mid-market'],
    notes: 'Piloting workflow automation with the operations team.',
  },
  {
    key: 'umbrella',
    firstName: 'Daniel',
    lastName: 'Okafor',
    email: 'daniel.okafor@umbrella.test',
    phone: '+1-555-0104',
    company: 'Umbrella Health',
    jobTitle: 'Compliance Lead',
    status: 'Prospect',
    ownerEmail: 'sales.hod@acme.test',
    tags: ['healthcare', 'compliance'],
    notes: 'Needs audit trails and role-based access evidence.',
  },
  {
    key: 'contoso',
    firstName: 'Sofia',
    lastName: 'Alvarez',
    email: 'sofia.alvarez@contoso.test',
    phone: '+1-555-0105',
    company: 'Contoso Retail',
    jobTitle: 'Store Systems Manager',
    status: 'Customer',
    ownerEmail: 'sales.lead@acme.test',
    tags: ['retail', 'rollout'],
    notes: 'Rolling out to 24 stores over the next two quarters.',
  },
  {
    key: 'stellar',
    firstName: 'Ethan',
    lastName: 'Brooks',
    email: 'ethan.brooks@stellar.test',
    phone: '+1-555-0106',
    company: 'Stellar Logistics',
    jobTitle: 'Fleet Operations',
    status: 'Lead',
    ownerEmail: 'staff@acme.test',
    tags: ['logistics', 'inbound'],
    notes: 'Downloaded the inventory guide after a webinar.',
  },
  {
    key: 'hooli',
    firstName: 'Maya',
    lastName: 'Chen',
    email: 'maya.chen@hooli.test',
    phone: '+1-555-0107',
    company: 'Hooli',
    jobTitle: 'Analytics Manager',
    status: 'Qualified',
    ownerEmail: 'sales.lead@acme.test',
    tags: ['analytics', 'expansion'],
    notes: 'Wants dashboard presets for the executive team.',
  },
  {
    key: 'vertex',
    firstName: 'Liam',
    lastName: 'Patel',
    email: 'liam.patel@vertex.test',
    phone: '+1-555-0108',
    company: 'Vertex Manufacturing',
    jobTitle: 'Plant Director',
    status: 'Prospect',
    ownerEmail: 'staff@acme.test',
    tags: ['manufacturing'],
    notes: 'Evaluating inventory and procurement workflows.',
  },
  {
    key: 'aperture',
    firstName: 'Nora',
    lastName: 'Ibrahim',
    email: 'nora.ibrahim@aperture.test',
    phone: '+1-555-0109',
    company: 'Aperture Labs',
    jobTitle: 'Research Operations',
    status: 'Customer',
    ownerEmail: 'sales.hod@acme.test',
    tags: ['research', 'integration'],
    notes: 'Lab integration was paused; revisit next fiscal year.',
  },
  {
    key: 'soylent',
    firstName: 'Owen',
    lastName: 'Fischer',
    email: 'owen.fischer@soylent.test',
    phone: '+1-555-0110',
    company: 'Soylent Foods',
    jobTitle: 'Category Buyer',
    status: 'Inactive',
    ownerEmail: 'staff@acme.test',
    tags: ['food', 'lapsed'],
    notes: 'Account went dormant after the merger.',
  },
  {
    key: 'piedpiper',
    firstName: 'Chloe',
    lastName: 'Dubois',
    email: 'chloe.dubois@piedpiper.test',
    phone: '+1-555-0111',
    company: 'Pied Piper',
    jobTitle: 'Engineering Manager',
    status: 'Lead',
    ownerEmail: 'staff@acme.test',
    tags: ['compression', 'inbound'],
    notes: 'Requested a proof-of-concept workspace.',
  },
  {
    key: 'vandelay',
    firstName: 'Jonah',
    lastName: 'Reed',
    email: 'jonah.reed@vandelay.test',
    phone: '+1-555-0112',
    company: 'Vandelay Imports',
    jobTitle: 'Import Coordinator',
    status: 'Lead',
    ownerEmail: 'sales.lead@acme.test',
    tags: ['imports', 'inbound'],
    notes: 'Interested in document management and approvals.',
  },
];

interface ProjectSeed {
  key: string;
  name: string;
  description: string;
  status: string;
  startDate: Date;
  endDate: Date;
  budget: number;
  priority: number;
  ownerEmail: string;
}

const PROJECTS: ProjectSeed[] = [
  {
    key: 'website',
    name: 'Website Relaunch',
    description: 'Refresh the public site, pricing pages, and customer portal.',
    status: 'In Progress',
    startDate: daysAgo(90),
    endDate: daysFromNow(30),
    budget: 45000,
    priority: 3,
    ownerEmail: 'ops.staff@acme.test',
  },
  {
    key: 'erp',
    name: 'ERP Migration',
    description: 'Move finance and inventory workloads to the new ERP.',
    status: 'Planning',
    startDate: daysAgo(15),
    endDate: daysFromNow(180),
    budget: 120000,
    priority: 3,
    ownerEmail: 'it.hod@acme.test',
  },
  {
    key: 'onboarding',
    name: 'Customer Onboarding Refresh',
    description: 'Standardise onboarding checklists and support handoffs.',
    status: 'Completed',
    startDate: daysAgo(180),
    endDate: daysAgo(20),
    budget: 18000,
    priority: 2,
    ownerEmail: 'sales.hod@acme.test',
  },
];

interface TaskSeed {
  title: string;
  description: string;
  status: string;
  priority: number;
  dueDate: Date;
  projectKey: string;
  assigneeEmail: string;
}

const TASKS: TaskSeed[] = [
  {
    title: 'Finalize homepage wireframes',
    description: 'Lock the hero, pricing, and proof sections with design.',
    status: 'In Progress',
    priority: 2,
    dueDate: daysFromNow(3),
    projectKey: 'website',
    assigneeEmail: 'sales.lead@acme.test',
  },
  {
    title: 'Migrate customer records',
    description: 'Dry-run the customer and contact migration in staging.',
    status: 'Todo',
    priority: 3,
    dueDate: daysFromNow(20),
    projectKey: 'erp',
    assigneeEmail: 'ops.staff@acme.test',
  },
  {
    title: 'Write launch announcement',
    description: 'Prepare the customer email and release notes.',
    status: 'Review',
    priority: 2,
    dueDate: daysFromNow(2),
    projectKey: 'website',
    assigneeEmail: 'staff@acme.test',
  },
  {
    title: 'Audit ERP integrations',
    description: 'Map every inbound and outbound integration before cutover.',
    status: 'In Progress',
    priority: 3,
    dueDate: daysFromNow(10),
    projectKey: 'erp',
    assigneeEmail: 'it.hod@acme.test',
  },
  {
    title: 'Publish onboarding guide',
    description: 'Document the refreshed onboarding checklist.',
    status: 'Completed',
    priority: 1,
    dueDate: daysAgo(15),
    projectKey: 'onboarding',
    assigneeEmail: 'staff@acme.test',
  },
  {
    title: 'Set up staging environment',
    description: 'Provision staging, seed demo data, and configure backups.',
    status: 'Completed',
    priority: 2,
    dueDate: daysAgo(40),
    projectKey: 'website',
    assigneeEmail: 'ops.staff@acme.test',
  },
  {
    title: 'Review vendor contracts',
    description: 'Check renewal dates and data processing terms.',
    status: 'Review',
    priority: 3,
    dueDate: daysFromNow(1),
    projectKey: 'erp',
    assigneeEmail: 'finance.hod@acme.test',
  },
  {
    title: 'Collect customer feedback',
    description: 'Run five onboarding interviews and summarise themes.',
    status: 'Todo',
    priority: 1,
    dueDate: daysFromNow(7),
    projectKey: 'onboarding',
    assigneeEmail: 'support.staff@acme.test',
  },
  {
    title: 'Train sales on new CRM',
    description: 'Deliver two enablement sessions and record the walkthrough.',
    status: 'In Progress',
    priority: 2,
    dueDate: daysFromNow(5),
    projectKey: 'onboarding',
    assigneeEmail: 'sales.hod@acme.test',
  },
  {
    title: 'Archive legacy assets',
    description: 'Move old campaign assets to cold storage.',
    status: 'Completed',
    priority: 1,
    dueDate: daysAgo(60),
    projectKey: 'website',
    assigneeEmail: 'ops.staff@acme.test',
  },
  {
    title: 'Define ERP rollback plan',
    description:
      'Document owners, checkpoints, and the rollback decision tree.',
    status: 'Todo',
    priority: 3,
    dueDate: daysFromNow(25),
    projectKey: 'erp',
    assigneeEmail: 'it.hod@acme.test',
  },
  {
    title: 'Refresh support macros',
    description: 'Update canned responses for the new onboarding flow.',
    status: 'Completed',
    priority: 1,
    dueDate: daysAgo(10),
    projectKey: 'onboarding',
    assigneeEmail: 'support.staff@acme.test',
  },
];

interface InventorySeed {
  name: string;
  description: string;
  sku: string;
  quantity: number;
  unit: string;
  minStock: number;
  location: string;
}

const INVENTORY: InventorySeed[] = [
  {
    name: 'Dell Latitude 7440',
    description: 'Standard issue 14-inch business laptop.',
    sku: 'ACME-LAP-001',
    quantity: 14,
    unit: 'units',
    minStock: 5,
    location: 'HQ IT Store',
  },
  {
    name: 'Dell UltraSharp 27',
    description: '27-inch QHD USB-C monitor.',
    sku: 'ACME-MON-002',
    quantity: 22,
    unit: 'units',
    minStock: 8,
    location: 'HQ IT Store',
  },
  {
    name: 'Logitech MX Keys',
    description: 'Wireless keyboard for desk setups.',
    sku: 'ACME-KEY-003',
    quantity: 6,
    unit: 'units',
    minStock: 10,
    location: 'HQ IT Store',
  },
  {
    name: 'Herman Miller Aeron',
    description: 'Ergonomic task chair.',
    sku: 'ACME-CHR-004',
    quantity: 9,
    unit: 'units',
    minStock: 4,
    location: 'Facilities Warehouse',
  },
  {
    name: 'PowerEdge R760',
    description: 'Rack server for the staging cluster.',
    sku: 'ACME-SRV-005',
    quantity: 2,
    unit: 'units',
    minStock: 1,
    location: 'Data Centre Rack B',
  },
  {
    name: 'Microsoft 365 E5',
    description: 'Productivity and security licence bundle.',
    sku: 'ACME-LIC-006',
    quantity: 120,
    unit: 'seats',
    minStock: 50,
    location: 'Digital',
  },
  {
    name: 'Figma Organization',
    description: 'Design collaboration licence.',
    sku: 'ACME-LIC-007',
    quantity: 35,
    unit: 'seats',
    minStock: 20,
    location: 'Digital',
  },
  {
    name: 'Cisco Meraki MX68',
    description: 'Branch firewall and SD-WAN appliance.',
    sku: 'ACME-NET-008',
    quantity: 4,
    unit: 'units',
    minStock: 2,
    location: 'Network Cupboard',
  },
];

interface InvoiceSeed {
  invoiceNumber: string;
  customerKey: string;
  amount: number;
  status: string;
  dueDate: Date;
  paidDate?: Date;
}

const INVOICES: InvoiceSeed[] = [
  {
    invoiceNumber: 'ACME-INV-2026-001',
    customerKey: 'northwind',
    amount: 12500,
    status: 'Paid',
    dueDate: daysAgo(20),
    paidDate: daysAgo(18),
  },
  {
    invoiceNumber: 'ACME-INV-2026-002',
    customerKey: 'globex',
    amount: 8200,
    status: 'Paid',
    dueDate: daysAgo(45),
    paidDate: daysAgo(44),
  },
  {
    invoiceNumber: 'ACME-INV-2026-003',
    customerKey: 'contoso',
    amount: 6400,
    status: 'Paid',
    dueDate: daysAgo(10),
    paidDate: daysAgo(9),
  },
  {
    invoiceNumber: 'ACME-INV-2026-004',
    customerKey: 'umbrella',
    amount: 9800,
    status: 'Pending',
    dueDate: daysFromNow(5),
  },
  {
    invoiceNumber: 'ACME-INV-2026-005',
    customerKey: 'hooli',
    amount: 4300,
    status: 'Pending',
    dueDate: daysFromNow(12),
  },
  {
    invoiceNumber: 'ACME-INV-2026-006',
    customerKey: 'aperture',
    amount: 7100,
    status: 'Overdue',
    dueDate: daysAgo(14),
  },
];

interface ExpenseSeed {
  description: string;
  amount: number;
  category: string;
  incurredAt: Date;
  departmentKey: string;
  userEmail: string;
}

const EXPENSES: ExpenseSeed[] = [
  {
    description: 'Client travel to Northwind summit',
    amount: 1850,
    category: 'Travel',
    incurredAt: monthsAgo(0, 8),
    departmentKey: 'sales',
    userEmail: 'sales.hod@acme.test',
  },
  {
    description: 'Engineering software renewals',
    amount: 4200,
    category: 'Software',
    incurredAt: monthsAgo(0, 4),
    departmentKey: 'operations',
    userEmail: 'ops.staff@acme.test',
  },
  {
    description: 'Office supplies restock',
    amount: 980,
    category: 'Office',
    incurredAt: monthsAgo(1, 12),
    departmentKey: 'operations',
    userEmail: 'ops.staff@acme.test',
  },
  {
    description: 'Q3 demand-gen campaign',
    amount: 6200,
    category: 'Marketing',
    incurredAt: monthsAgo(1, 19),
    departmentKey: 'sales',
    userEmail: 'sales.lead@acme.test',
  },
  {
    description: 'Monthly payroll run',
    amount: 14500,
    category: 'Payroll',
    incurredAt: monthsAgo(2, 26),
    departmentKey: 'human_resources',
    userEmail: 'hr.hod@acme.test',
  },
  {
    description: 'Finance team offsite deposit',
    amount: 750,
    category: 'Other',
    incurredAt: monthsAgo(2, 14),
    departmentKey: 'finance',
    userEmail: 'finance.hod@acme.test',
  },
  {
    description: 'Sales conference travel',
    amount: 2300,
    category: 'Travel',
    incurredAt: monthsAgo(3, 9),
    departmentKey: 'sales',
    userEmail: 'sales.hod@acme.test',
  },
  {
    description: 'Cloud infrastructure top-up',
    amount: 3900,
    category: 'Software',
    incurredAt: monthsAgo(3, 21),
    departmentKey: 'operations',
    userEmail: 'ops.staff@acme.test',
  },
  {
    description: 'Finance workspace upgrade',
    amount: 1120,
    category: 'Office',
    incurredAt: monthsAgo(4, 6),
    departmentKey: 'finance',
    userEmail: 'finance.hod@acme.test',
  },
  {
    description: 'Product launch advertising',
    amount: 4800,
    category: 'Marketing',
    incurredAt: monthsAgo(4, 17),
    departmentKey: 'sales',
    userEmail: 'sales.lead@acme.test',
  },
  {
    description: 'Prior-month payroll run',
    amount: 15100,
    category: 'Payroll',
    incurredAt: monthsAgo(5, 26),
    departmentKey: 'human_resources',
    userEmail: 'hr.hod@acme.test',
  },
  {
    description: 'Warehouse logistics travel',
    amount: 1650,
    category: 'Travel',
    incurredAt: monthsAgo(5, 11),
    departmentKey: 'operations',
    userEmail: 'ops.staff@acme.test',
  },
  {
    description: 'Analytics platform licence',
    amount: 2700,
    category: 'Software',
    incurredAt: monthsAgo(2, 3),
    departmentKey: 'finance',
    userEmail: 'finance.hod@acme.test',
  },
  {
    description: 'HR onboarding supplies',
    amount: 860,
    category: 'Office',
    incurredAt: monthsAgo(0, 16),
    departmentKey: 'human_resources',
    userEmail: 'hr.hod@acme.test',
  },
];

interface DealSeed {
  name: string;
  contactKey: string;
  amount: number;
  status: DealStatus;
  closeDate: Date;
  ownerEmail: string;
}

const DEALS: DealSeed[] = [
  {
    name: 'Northwind platform expansion',
    contactKey: 'northwind',
    amount: 48000,
    status: DealStatus.LEAD,
    closeDate: daysFromNow(45),
    ownerEmail: 'sales.lead@acme.test',
  },
  {
    name: 'Globex annual renewal',
    contactKey: 'globex',
    amount: 36000,
    status: DealStatus.QUALIFIED,
    closeDate: daysFromNow(30),
    ownerEmail: 'sales.hod@acme.test',
  },
  {
    name: 'Initech workflow pilot',
    contactKey: 'initech',
    amount: 22000,
    status: DealStatus.PROPOSAL,
    closeDate: daysFromNow(20),
    ownerEmail: 'sales.lead@acme.test',
  },
  {
    name: 'Umbrella compliance suite',
    contactKey: 'umbrella',
    amount: 54000,
    status: DealStatus.NEGOTIATION,
    closeDate: daysFromNow(14),
    ownerEmail: 'sales.hod@acme.test',
  },
  {
    name: 'Contoso retail rollout',
    contactKey: 'contoso',
    amount: 41000,
    status: DealStatus.WON,
    closeDate: daysAgo(10),
    ownerEmail: 'sales.lead@acme.test',
  },
  {
    name: 'Hooli analytics add-on',
    contactKey: 'hooli',
    amount: 18500,
    status: DealStatus.QUALIFIED,
    closeDate: daysFromNow(28),
    ownerEmail: 'staff@acme.test',
  },
  {
    name: 'Aperture lab integration',
    contactKey: 'aperture',
    amount: 27000,
    status: DealStatus.LOST,
    closeDate: daysAgo(25),
    ownerEmail: 'sales.hod@acme.test',
  },
  {
    name: 'Pied Piper proof of concept',
    contactKey: 'piedpiper',
    amount: 15000,
    status: DealStatus.LEAD,
    closeDate: daysFromNow(60),
    ownerEmail: 'staff@acme.test',
  },
];

interface TicketSeed {
  subject: string;
  description: string;
  status: TicketStatus;
  priority: number;
  contactKey: string;
  assigneeEmail: string;
  slaDueDate: Date;
  resolvedAt?: Date;
  customerRating?: number;
}

const TICKETS: TicketSeed[] = [
  {
    subject: 'Cannot access payroll dashboard',
    description: 'Finance users see an empty payroll widget after SSO.',
    status: TicketStatus.OPEN,
    priority: 2,
    contactKey: 'aperture',
    assigneeEmail: 'support.staff@acme.test',
    slaDueDate: daysFromNow(1),
  },
  {
    subject: 'Invoice PDF missing logo',
    description: 'The generated invoice PDF omits the customer logo.',
    status: TicketStatus.OPEN,
    priority: 1,
    contactKey: 'contoso',
    assigneeEmail: 'support.staff@acme.test',
    slaDueDate: daysFromNow(2),
  },
  {
    subject: 'SSO login loop for finance',
    description: 'Finance users bounce between the IdP and the workspace.',
    status: TicketStatus.IN_PROGRESS,
    priority: 3,
    contactKey: 'globex',
    assigneeEmail: 'it.hod@acme.test',
    slaDueDate: daysFromNow(1),
  },
  {
    subject: 'Bulk import fails at 500 rows',
    description: 'CSV imports stop after 500 contacts without an error.',
    status: TicketStatus.IN_PROGRESS,
    priority: 2,
    contactKey: 'initech',
    assigneeEmail: 'it.hod@acme.test',
    slaDueDate: daysFromNow(2),
  },
  {
    subject: 'Password reset email delayed',
    description: 'Reset emails arrive after the token expires.',
    status: TicketStatus.RESOLVED,
    priority: 2,
    contactKey: 'hooli',
    assigneeEmail: 'support.staff@acme.test',
    slaDueDate: daysAgo(3),
    resolvedAt: daysAgo(1),
    customerRating: 4,
  },
  {
    subject: 'API rate limit clarification',
    description: 'Customer needs the burst and sustained limits documented.',
    status: TicketStatus.RESOLVED,
    priority: 1,
    contactKey: 'piedpiper',
    assigneeEmail: 'it.hod@acme.test',
    slaDueDate: daysAgo(8),
    resolvedAt: daysAgo(6),
    customerRating: 5,
  },
  {
    subject: 'Duplicate contact records',
    description: 'Two contacts were created from the same inbound form.',
    status: TicketStatus.CLOSED,
    priority: 1,
    contactKey: 'northwind',
    assigneeEmail: 'support.staff@acme.test',
    slaDueDate: daysAgo(24),
    resolvedAt: daysAgo(20),
  },
  {
    subject: 'Billing address correction',
    description:
      'Invoice billing address was updated after the finance review.',
    status: TicketStatus.CLOSED,
    priority: 2,
    contactKey: 'umbrella',
    assigneeEmail: 'finance.hod@acme.test',
    slaDueDate: daysAgo(21),
    resolvedAt: daysAgo(18),
    customerRating: 5,
  },
];

interface DocumentSeed {
  slug: string;
  title: string;
  category: string;
  status: DocumentStatus;
  departmentKey?: string;
  moduleKey?: string;
  createdByEmail: string;
  content: string;
}

const DOCUMENTS: DocumentSeed[] = [
  {
    slug: 'employee-handbook',
    title: 'Employee Handbook',
    category: 'Policies',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'human_resources',
    moduleKey: 'document-management',
    createdByEmail: 'hr.hod@acme.test',
    content: `# Employee Handbook

## Welcome
Acme Corp is a distributed team. This handbook covers the basics of working here.

## Working hours
- Core hours are 10:00-15:00 local time.
- Async updates are expected in the team channel.

## Time off
Request leave at least five working days in advance.`,
  },
  {
    slug: 'expense-policy',
    title: 'Expense Policy',
    category: 'Policies',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'finance',
    moduleKey: 'document-management',
    createdByEmail: 'finance.hod@acme.test',
    content: `# Expense Policy

## Eligible expenses
- Travel booked through the approved travel portal.
- Software with a named owner and renewal date.
- Client entertainment up to $150 per person.

## Approval
Expenses above $500 require department head approval.`,
  },
  {
    slug: 'it-security-sop',
    title: 'IT Security SOP',
    category: 'SOPs',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'information_technology',
    moduleKey: 'document-management',
    createdByEmail: 'it.hod@acme.test',
    content: `# IT Security SOP

## Device onboarding
1. Enroll the device in MDM.
2. Enable disk encryption and screen lock.
3. Install the endpoint agent.

## Access reviews
Review privileged access every quarter and remove dormant accounts.`,
  },
  {
    slug: 'sales-playbook',
    title: 'Sales Playbook',
    category: 'Wiki',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'sales',
    moduleKey: 'document-management',
    createdByEmail: 'sales.hod@acme.test',
    content: `# Sales Playbook

## Discovery
Ask about the current workflow, decision makers, and success measures.

## Pipeline stages
- Lead
- Qualified
- Proposal
- Negotiation
- Won

## Handoff
Create an onboarding checklist before the contract is countersigned.`,
  },
  {
    slug: 'security-policy',
    title: 'Information Security Policy',
    category: 'Policies',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'administration',
    moduleKey: 'document-management',
    createdByEmail: 'admin@acme.test',
    content: `# Information Security Policy

## Principles
- Least privilege by default.
- Encrypt data in transit and at rest.
- Log administrative actions.

## Incident response
Report suspected incidents within one hour and preserve evidence.`,
  },
  {
    slug: 'onboarding-checklist',
    title: 'Onboarding Checklist',
    category: 'Templates',
    status: DocumentStatus.DRAFT,
    departmentKey: 'human_resources',
    moduleKey: 'onboarding',
    createdByEmail: 'hr.hod@acme.test',
    content: `# Onboarding Checklist

## Before day one
- [ ] Create IT accounts
- [ ] Prepare equipment
- [ ] Send welcome email

## First week
- [ ] HR paperwork
- [ ] Security training
- [ ] Team introduction`,
  },
  {
    slug: 'support-runbook',
    title: 'Support Escalation Runbook',
    category: 'SOPs',
    status: DocumentStatus.PUBLISHED,
    departmentKey: 'customer_support',
    moduleKey: 'sla-management',
    createdByEmail: 'support.staff@acme.test',
    content: `# Support Escalation Runbook

## Severity levels
- P1: production outage, 24 hour SLA.
- P2: degraded workflow, 8 hour SLA.
- P3: question or request, 4 hour SLA.

## Escalation
Escalate to the on-call engineer when the SLA is within one hour.`,
  },
  {
    slug: 'procurement-wiki',
    title: 'Procurement Wiki',
    category: 'Wiki',
    status: DocumentStatus.DRAFT,
    departmentKey: 'finance',
    moduleKey: 'document-management',
    createdByEmail: 'finance.hod@acme.test',
    content: `# Procurement Wiki

## Vendor onboarding
Collect security review, tax details, and a signed data processing agreement.

## Purchase orders
Raise a purchase order before work begins.`,
  },
];

interface NotificationSeed {
  title: string;
  message: string;
  type: string;
  read: boolean;
  userEmail: string;
}

const NOTIFICATIONS: NotificationSeed[] = [
  {
    title: 'Invoice ACME-INV-2026-006 is overdue',
    message: 'Aperture Labs has an overdue balance of $7,100.00.',
    type: 'warning',
    read: false,
    userEmail: 'finance.hod@acme.test',
  },
  {
    title: 'Deal moved to Negotiation',
    message: 'Umbrella compliance suite moved to Negotiation.',
    type: 'info',
    read: false,
    userEmail: 'sales.hod@acme.test',
  },
  {
    title: 'New support ticket assigned',
    message: 'SSO login loop for finance is now assigned to you.',
    type: 'info',
    read: false,
    userEmail: 'it.hod@acme.test',
  },
  {
    title: 'Expense awaiting approval',
    message: 'Q3 demand-gen campaign is awaiting finance approval.',
    type: 'warning',
    read: true,
    userEmail: 'finance.hod@acme.test',
  },
  {
    title: 'Document published: Employee Handbook',
    message: 'The Employee Handbook is now visible to every department.',
    type: 'success',
    read: true,
    userEmail: 'admin@acme.test',
  },
];

export async function seedAcme(
  prisma: PrismaClient,
  passwordHash: string,
): Promise<void> {
  const userCount = await prisma.$transaction(
    async (tx) => {
      const tenantId = await ensureProvisionedTenant(tx, ACME_TENANT);
      const structure = await ensureTemplateStructure(
        tx,
        tenantId,
        DEMO_TEMPLATE,
      );

      const userIdByEmail = new Map<string, string>();
      for (const user of ACME_USERS) {
        const roleId = structure.roleIdBySlug.get(user.roleSlug);
        if (!roleId) {
          throw new Error(`Acme role "${user.roleSlug}" is missing.`);
        }

        const departmentId = user.departmentKey
          ? structure.departmentIdByKey.get(user.departmentKey)
          : null;
        if (user.departmentKey && !departmentId) {
          throw new Error(
            `Acme department "${user.departmentKey}" is missing.`,
          );
        }

        const created = await upsertSeedUser(tx, {
          tenantId,
          email: user.email,
          name: user.name,
          passwordHash,
          roleId,
          departmentId,
        });
        userIdByEmail.set(created.email, created.id);
      }

      const requireUser = (email: string): string => {
        const id = userIdByEmail.get(email);
        if (!id) throw new Error(`Acme user "${email}" was not seeded.`);
        return id;
      };
      const requireDepartment = (key: string): string => {
        const id = structure.departmentIdByKey.get(key);
        if (!id) throw new Error(`Acme department "${key}" is missing.`);
        return id;
      };
      const requireModule = (key: string): string | null =>
        structure.moduleIdByKey.get(key) ?? null;

      // Department heads manage their department.
      const managerByEmail: Array<[string, string]> = [
        ['finance', 'finance.hod@acme.test'],
        ['sales', 'sales.hod@acme.test'],
        ['human_resources', 'hr.hod@acme.test'],
        ['information_technology', 'it.hod@acme.test'],
      ];
      for (const [departmentKey, managerEmail] of managerByEmail) {
        await tx.department.update({
          where: {
            tenantId_key: { tenantId, key: departmentKey },
          },
          data: { managerId: requireUser(managerEmail) },
        });
      }

      const salesTeam = await findOrCreateTeam(tx, {
        tenantId,
        name: 'Enterprise Sales',
        description: 'Mid-market and enterprise account team.',
        departmentId: requireDepartment('sales'),
        leadUserId: requireUser('sales.lead@acme.test'),
      });
      await ensureTeamMember(tx, {
        tenantId,
        teamId: salesTeam.id,
        userId: requireUser('sales.lead@acme.test'),
        role: 'Lead',
      });
      await ensureTeamMember(tx, {
        tenantId,
        teamId: salesTeam.id,
        userId: requireUser('staff@acme.test'),
      });
      await ensureTeamMember(tx, {
        tenantId,
        teamId: salesTeam.id,
        userId: requireUser('sales.hod@acme.test'),
      });

      // Contacts
      const contactIdByKey = new Map<string, string>();
      for (const contact of CONTACTS) {
        const data = {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          company: contact.company,
          jobTitle: contact.jobTitle,
          notes: contact.notes,
          status: contact.status,
          tags: contact.tags,
          customFields: { seedKey: `acme-contact-${contact.key}` },
        };
        const ownerId = requireUser(contact.ownerEmail);
        const existing = await tx.contact.findFirst({
          where: { tenantId, email: contact.email },
          select: { id: true },
        });
        const saved = existing
          ? await tx.contact.update({
              where: { id: existing.id },
              data: { ...data, userId: ownerId },
              select: { id: true },
            })
          : await tx.contact.create({
              data: { tenantId, userId: ownerId, ...data },
              select: { id: true },
            });
        contactIdByKey.set(contact.key, saved.id);
      }

      const requireContact = (key: string): string => {
        const id = contactIdByKey.get(key);
        if (!id) throw new Error(`Acme contact "${key}" was not seeded.`);
        return id;
      };

      // Projects
      const projectIdByKey = new Map<string, string>();
      for (const project of PROJECTS) {
        const data = {
          name: project.name,
          description: project.description,
          status: project.status,
          startDate: project.startDate,
          endDate: project.endDate,
          budget: project.budget,
          priority: project.priority,
          userId: requireUser(project.ownerEmail),
        };
        const existing = await tx.project.findFirst({
          where: { tenantId, name: project.name },
          select: { id: true },
        });
        const saved = existing
          ? await tx.project.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            })
          : await tx.project.create({
              data: { tenantId, ...data },
              select: { id: true },
            });
        projectIdByKey.set(project.key, saved.id);
      }

      const requireProject = (key: string): string => {
        const id = projectIdByKey.get(key);
        if (!id) throw new Error(`Acme project "${key}" was not seeded.`);
        return id;
      };

      // Tasks
      for (const task of TASKS) {
        const data = {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          projectId: requireProject(task.projectKey),
          assignedToId: requireUser(task.assigneeEmail),
        };
        const existing = await tx.task.findFirst({
          where: { tenantId, title: task.title },
          select: { id: true },
        });
        if (existing) {
          await tx.task.update({ where: { id: existing.id }, data });
        } else {
          await tx.task.create({ data: { tenantId, ...data } });
        }
      }

      // Inventory
      for (const item of INVENTORY) {
        const data = {
          name: item.name,
          description: item.description,
          sku: item.sku,
          quantity: item.quantity,
          unit: item.unit,
          minStock: item.minStock,
          location: item.location,
        };
        await tx.inventoryItem.upsert({
          where: { tenantId_sku: { tenantId, sku: item.sku } },
          update: data,
          create: { tenantId, ...data },
        });
      }

      // Invoices
      const invoiceIdByNumber = new Map<string, string>();
      for (const invoice of INVOICES) {
        const data = {
          customerId: requireContact(invoice.customerKey),
          amount: invoice.amount,
          status: invoice.status,
          dueDate: invoice.dueDate,
          paidDate: invoice.paidDate ?? null,
        };
        const saved = await tx.invoice.upsert({
          where: {
            tenantId_invoiceNumber: {
              tenantId,
              invoiceNumber: invoice.invoiceNumber,
            },
          },
          update: data,
          create: {
            tenantId,
            invoiceNumber: invoice.invoiceNumber,
            ...data,
          },
          select: { id: true },
        });
        invoiceIdByNumber.set(invoice.invoiceNumber, saved.id);
      }

      // Payments: two instalments per paid invoice.
      for (const invoice of INVOICES) {
        if (invoice.status !== 'Paid') continue;

        const invoiceId = invoiceIdByNumber.get(invoice.invoiceNumber);
        if (!invoiceId) {
          throw new Error(`Invoice "${invoice.invoiceNumber}" was not seeded.`);
        }

        const first = Math.round(invoice.amount * 0.6);
        const second = invoice.amount - first;
        const instalments = [
          { method: 'Bank transfer', amount: first, paidAt: daysAgo(19) },
          { method: 'Credit card', amount: second, paidAt: daysAgo(18) },
        ];

        for (const instalment of instalments) {
          const existing = await tx.payment.findFirst({
            where: { tenantId, invoiceId, method: instalment.method },
            select: { id: true },
          });
          const data = {
            invoiceId,
            amount: instalment.amount,
            paidAt: instalment.paidAt,
            method: instalment.method,
          };
          if (existing) {
            await tx.payment.update({ where: { id: existing.id }, data });
          } else {
            await tx.payment.create({ data: { tenantId, ...data } });
          }
        }
      }

      // Expenses
      for (const expense of EXPENSES) {
        const data = {
          description: expense.description,
          amount: expense.amount,
          category: expense.category,
          incurredAt: expense.incurredAt,
          departmentId: requireDepartment(expense.departmentKey),
          userId: requireUser(expense.userEmail),
          customFields: { seedKey: `acme-expense-${expense.description}` },
        };
        const existing = await tx.expense.findFirst({
          where: { tenantId, description: expense.description },
          select: { id: true },
        });
        if (existing) {
          await tx.expense.update({ where: { id: existing.id }, data });
        } else {
          await tx.expense.create({ data: { tenantId, ...data } });
        }
      }

      // Deals
      const dealIdByName = new Map<string, string>();
      for (const deal of DEALS) {
        const data = {
          name: deal.name,
          contactId: requireContact(deal.contactKey),
          amount: deal.amount,
          status: deal.status,
          closeDate: deal.closeDate,
          userId: requireUser(deal.ownerEmail),
        };
        const existing = await tx.deal.findFirst({
          where: { tenantId, name: deal.name },
          select: { id: true },
        });
        const saved = existing
          ? await tx.deal.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            })
          : await tx.deal.create({
              data: { tenantId, ...data },
              select: { id: true },
            });
        dealIdByName.set(deal.name, saved.id);
      }

      // Support tickets
      const ticketIds: string[] = [];
      for (const ticket of TICKETS) {
        const data = {
          subject: ticket.subject,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          contactId: requireContact(ticket.contactKey),
          userId: requireUser(ticket.assigneeEmail),
          slaDueDate: ticket.slaDueDate,
          resolvedAt: ticket.resolvedAt ?? null,
          customerRating: ticket.customerRating ?? null,
          customFields: { seedKey: `acme-ticket-${ticket.subject}` },
        };
        const existing = await tx.supportTicket.findFirst({
          where: { tenantId, subject: ticket.subject },
          select: { id: true },
        });
        const saved = existing
          ? await tx.supportTicket.update({
              where: { id: existing.id },
              data,
              select: { id: true },
            })
          : await tx.supportTicket.create({
              data: { tenantId, ...data },
              select: { id: true },
            });
        ticketIds.push(saved.id);
      }

      // Documents
      const documentIdBySlug = new Map<string, string>();
      for (const document of DOCUMENTS) {
        const data = {
          title: document.title,
          format: DocumentFormat.MARKDOWN,
          status: document.status,
          category: document.category,
          content: document.content,
          departmentId: document.departmentKey
            ? requireDepartment(document.departmentKey)
            : null,
          moduleId: document.moduleKey
            ? requireModule(document.moduleKey)
            : null,
          createdById: requireUser(document.createdByEmail),
          updatedById: requireUser(document.createdByEmail),
        };
        const saved = await tx.document.upsert({
          where: { tenantId_slug: { tenantId, slug: document.slug } },
          update: data,
          create: { tenantId, slug: document.slug, ...data },
          select: { id: true },
        });
        documentIdBySlug.set(document.slug, saved.id);
      }

      // Audit log: 25 representative events.
      const auditRows: Prisma.AuditLogCreateManyInput[] = [];
      const images: Array<{
        action: string;
        entity: string;
        entityId: string;
        actorEmail: string;
        departmentKey?: string;
      }> = [];

      for (const contact of CONTACTS) {
        images.push({
          action: 'contact.created',
          entity: 'contacts',
          entityId: requireContact(contact.key),
          actorEmail: contact.ownerEmail,
          departmentKey: 'sales',
        });
      }
      for (const invoice of INVOICES) {
        const entityId = invoiceIdByNumber.get(invoice.invoiceNumber);
        if (!entityId) continue;
        images.push({
          action: 'invoice.created',
          entity: 'invoices',
          entityId,
          actorEmail: 'finance.hod@acme.test',
          departmentKey: 'finance',
        });
        if (invoice.status === 'Paid') {
          images.push({
            action: 'invoice.paid',
            entity: 'invoices',
            entityId,
            actorEmail: 'finance.hod@acme.test',
            departmentKey: 'finance',
          });
        }
      }
      for (const deal of DEALS.slice(0, 2)) {
        const entityId = dealIdByName.get(deal.name);
        if (!entityId) continue;
        images.push({
          action: 'deal.stage_changed',
          entity: 'deals',
          entityId,
          actorEmail: deal.ownerEmail,
          departmentKey: 'sales',
        });
      }
      for (const slug of ['employee-handbook', 'it-security-sop']) {
        const entityId = documentIdBySlug.get(slug);
        if (!entityId) continue;
        images.push({
          action: 'document.published',
          entity: 'documents',
          entityId,
          actorEmail: 'admin@acme.test',
          departmentKey: 'administration',
        });
      }

      images.slice(0, 25).forEach((entry, index) => {
        auditRows.push({
          tenantId,
          departmentId: entry.departmentKey
            ? requireDepartment(entry.departmentKey)
            : null,
          actorId: requireUser(entry.actorEmail),
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          after: { seed: true },
          createdAt: daysAgo(60 - index),
        });
      });

      for (const row of auditRows) {
        const existing = await tx.auditLog.findFirst({
          where: {
            tenantId,
            entity: row.entity,
            entityId: row.entityId,
            action: row.action,
          },
          select: { id: true },
        });
        if (!existing) {
          await tx.auditLog.create({ data: row });
        }
      }

      // Notifications
      for (const notification of NOTIFICATIONS) {
        const userId = requireUser(notification.userEmail);
        const data = {
          title: notification.title,
          message: notification.message,
          read: notification.read,
          type: notification.type,
          userId,
        };
        const existing = await tx.notification.findFirst({
          where: { tenantId, userId, title: notification.title },
          select: { id: true },
        });
        if (existing) {
          await tx.notification.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.notification.create({ data: { tenantId, ...data } });
        }
      }

      // Keep the ticket id list referenced so future seeds can extend it.
      void ticketIds;

      return refreshTenantSeatCount(tx, tenantId);
    },
    { maxWait: 15_000, timeout: 180_000 },
  );

  console.log(
    `Acme Corp ready (${userCount} users; ${CONTACTS.length} contacts, ` +
      `${PROJECTS.length} projects, ${TASKS.length} tasks, ` +
      `${INVENTORY.length} inventory items, ${INVOICES.length} invoices, ` +
      `${EXPENSES.length} expenses, ${DEALS.length} deals, ` +
      `${TICKETS.length} tickets, ${DOCUMENTS.length} documents).`,
  );
}
