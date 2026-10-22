// prisma/seed-demo.ts
//
// Demo data seeder for the ClaspCRM tenant.
// Creates realistic business data so every dashboard role (ADMIN, HOD, LEAD, STAFF)
// renders real, tenant-scoped information. Idempotent: all inserts use
// findFirst/create or delete-by-tenant before re-inserting.
//
// Usage:
//   npm run seed:demo
//   or
//   npx ts-node prisma/seed-demo.ts

import {
  DealStatus,
  DepartmentType,
  EmploymentStatus,
  PrismaClient,
  Role,
  TicketStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
  },
});

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'default';

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
  });

  if (!tenant) {
    throw new Error(
      `Tenant "${DEFAULT_TENANT_SLUG}" not found. Run the base seed first.`,
    );
  }

  const tenantId = tenant.id;

  // Load departments (created by the base seed)
  const departments = await prisma.department.findMany({ where: { tenantId } });
  const deptByType = new Map(departments.map((d) => [d.type, d]));

  // Load all users for this tenant
  const users = await prisma.user.findMany({
    where: { tenantId },
    orderBy: { role: 'asc' },
  });
  const userByEmail = new Map(users.map((u) => [u.email, u]));

  // Helper: find a user by role+email pattern
  const findUser = (email: string) => {
    const user = userByEmail.get(email);
    if (!user) throw new Error(`User ${email} not found`);
    return user;
  };

  const hodFinance = findUser('hod.finance@claspcrm.com');
  const hodIT = findUser('hod.information_technology@claspcrm.com');
  const hodHR = findUser('hod.human_resources@claspcrm.com');
  const hodSales = findUser('hod.sales@claspcrm.com');
  const hodCS = findUser('hod.customer_service@claspcrm.com');
  const hodAcct = findUser('hod.accounting@claspcrm.com');
  const hodOps = findUser('hod.operations@claspcrm.com');
  const hodAdmin = findUser('hod.administration@claspcrm.com');

  const leadFinance = findUser('lead.finance@claspcrm.com');
  const leadIT = findUser('lead.information_technology@claspcrm.com');
  const leadHR = findUser('lead.human_resources@claspcrm.com');
  const leadSales = findUser('lead.sales@claspcrm.com');
  const leadCS = findUser('lead.customer_service@claspcrm.com');
  const leadAcct = findUser('lead.accounting@claspcrm.com');
  const leadOps = findUser('lead.operations@claspcrm.com');
  const leadAdmin = findUser('lead.administration@claspcrm.com');

  const staffF1 = findUser('staff1.finance@claspcrm.com');
  const staffF2 = findUser('staff2.finance@claspcrm.com');
  const staffIT1 = findUser('staff1.information_technology@claspcrm.com');
  const staffIT2 = findUser('staff2.information_technology@claspcrm.com');
  const staffHR1 = findUser('staff1.human_resources@claspcrm.com');
  const staffHR2 = findUser('staff2.human_resources@claspcrm.com');
  const staffS1 = findUser('staff1.sales@claspcrm.com');
  const staffS2 = findUser('staff2.sales@claspcrm.com');
  const staffCS1 = findUser('staff1.customer_service@claspcrm.com');
  const staffCS2 = findUser('staff2.customer_service@claspcrm.com');
  const staffA1 = findUser('staff1.accounting@claspcrm.com');
  const staffA2 = findUser('staff2.accounting@claspcrm.com');
  const staffO1 = findUser('staff1.operations@claspcrm.com');
  const staffO2 = findUser('staff2.operations@claspcrm.com');
  const staffAdm1 = findUser('staff1.administration@claspcrm.com');
  const staffAdm2 = findUser('staff2.administration@claspcrm.com');

  console.log(`[seed-demo] Using tenant ${tenant.name} (${tenantId})`);
  console.log(`[seed-demo] Users loaded: ${users.length}`);

  // Ensure all users are verified and active
  await prisma.user.updateMany({
    where: { tenantId },
    data: { isVerified: true, status: EmploymentStatus.ACTIVE },
  });

  // Wipe existing demo data for a clean re-seed
  console.log('[seed-demo] Clearing existing demo rows...');
  await prisma.attendanceRecord.deleteMany({ where: { tenantId } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.invoice.deleteMany({ where: { tenantId } });
  await prisma.expense.deleteMany({ where: { tenantId } });
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.projectMember.deleteMany({ where: { tenantId } });
  await prisma.projectFile.deleteMany({ where: { tenantId } });
  await prisma.project.deleteMany({ where: { tenantId } });
  await prisma.supportTicket.deleteMany({ where: { tenantId } });
  await prisma.deal.deleteMany({ where: { tenantId } });
  await prisma.contact.deleteMany({ where: { tenantId } });
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.inventoryItem.deleteMany({ where: { tenantId } });
  await prisma.teamMember.deleteMany({ where: { tenantId } });
  await prisma.team.deleteMany({ where: { tenantId } });

  // ── Teams ──────────────────────────────────────────────────────────
  console.log('[seed-demo] Creating teams...');
  const teams = await prisma.$transaction([
    prisma.team.create({
      data: {
        id: 'team-finance',
        name: 'Finance Squad',
        description: 'Revenue, expenses and financial reporting',
        departmentId: deptByType.get(DepartmentType.FINANCE)!.id,
        leadUserId: leadFinance.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-it',
        name: 'Platform Engineering',
        description: 'Infrastructure, security and support',
        departmentId: deptByType.get(DepartmentType.INFORMATION_TECHNOLOGY)!.id,
        leadUserId: leadIT.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-hr',
        name: 'People Operations',
        description: 'Recruitment, onboarding and employee success',
        departmentId: deptByType.get(DepartmentType.HUMAN_RESOURCES)!.id,
        leadUserId: leadHR.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-sales',
        name: 'Growth Sales',
        description: 'Pipeline management and client acquisition',
        departmentId: deptByType.get(DepartmentType.SALES)!.id,
        leadUserId: leadSales.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-support',
        name: 'Customer Success',
        description: 'Client support and issue resolution',
        departmentId: deptByType.get(DepartmentType.CUSTOMER_SERVICE)!.id,
        leadUserId: leadCS.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-accounting',
        name: 'Accounts Payable/Receivable',
        description: 'Billing, collections and compliance',
        departmentId: deptByType.get(DepartmentType.ACCOUNTING)!.id,
        leadUserId: leadAcct.id,
        tenantId,
      },
    }),
    prisma.team.create({
      data: {
        id: 'team-ops',
        name: 'Operations',
        description: 'Day-to-day operations and logistics',
        departmentId: deptByType.get(DepartmentType.OPERATIONS)!.id,
        leadUserId: leadOps.id,
        tenantId,
      },
    }),
  ]);

  await prisma.teamMember.createMany({
    data: [
      { teamId: 'team-finance', userId: leadFinance.id, tenantId, role: 'Lead' },
      { teamId: 'team-finance', userId: staffF1.id, tenantId, role: 'Member' },
      { teamId: 'team-finance', userId: staffF2.id, tenantId, role: 'Member' },
      { teamId: 'team-it', userId: leadIT.id, tenantId, role: 'Lead' },
      { teamId: 'team-it', userId: staffIT1.id, tenantId, role: 'Member' },
      { teamId: 'team-it', userId: staffIT2.id, tenantId, role: 'Member' },
      { teamId: 'team-hr', userId: leadHR.id, tenantId, role: 'Lead' },
      { teamId: 'team-hr', userId: staffHR1.id, tenantId, role: 'Member' },
      { teamId: 'team-hr', userId: staffHR2.id, tenantId, role: 'Member' },
      { teamId: 'team-sales', userId: leadSales.id, tenantId, role: 'Lead' },
      { teamId: 'team-sales', userId: staffS1.id, tenantId, role: 'Member' },
      { teamId: 'team-sales', userId: staffS2.id, tenantId, role: 'Member' },
      { teamId: 'team-support', userId: leadCS.id, tenantId, role: 'Lead' },
      { teamId: 'team-support', userId: staffCS1.id, tenantId, role: 'Member' },
      { teamId: 'team-support', userId: staffCS2.id, tenantId, role: 'Member' },
      { teamId: 'team-accounting', userId: leadAcct.id, tenantId, role: 'Lead' },
      { teamId: 'team-accounting', userId: staffA1.id, tenantId, role: 'Member' },
      { teamId: 'team-accounting', userId: staffA2.id, tenantId, role: 'Member' },
      { teamId: 'team-ops', userId: leadOps.id, tenantId, role: 'Lead' },
      { teamId: 'team-ops', userId: staffO1.id, tenantId, role: 'Member' },
      { teamId: 'team-ops', userId: staffO2.id, tenantId, role: 'Member' },
    ],
  });

  // ── Inventory (IT) ─────────────────────────────────────────────────
  console.log('[seed-demo] Creating inventory...');
  await prisma.inventoryItem.createMany({
    data: [
      {
        name: 'Dell Latitude 5440',
        description: 'Business laptop',
        sku: 'HW-LAP-001',
        quantity: 25,
        unit: 'pcs',
        minStock: 10,
        location: 'IT Storeroom',
        tenantId,
      },
      {
        name: 'Cisco Catalyst Switch',
        description: '24-port managed switch',
        sku: 'HW-SW-001',
        quantity: 4,
        unit: 'pcs',
        minStock: 2,
        location: 'Server Room',
        tenantId,
      },
      {
        name: 'Microsoft 365 Business',
        description: 'Software license subscription',
        sku: 'SW-LIC-001',
        quantity: 150,
        unit: 'licenses',
        minStock: 50,
        location: 'Cloud',
        tenantId,
      },
      {
        name: 'CrowdStrike Falcon',
        description: 'Endpoint protection license',
        sku: 'SW-SEC-001',
        quantity: 3,
        unit: 'licenses',
        minStock: 25,
        location: 'Cloud',
        tenantId,
      },
      {
        name: 'APC Smart UPS',
        description: 'Uninterruptible power supply',
        sku: 'HW-UPS-001',
        quantity: 2,
        unit: 'pcs',
        minStock: 2,
        location: 'Server Room',
        tenantId,
      },
      {
        name: 'TP-Link Access Point',
        description: 'WiFi 6 access point',
        sku: 'HW-WAP-001',
        quantity: 8,
        unit: 'pcs',
        minStock: 4,
        location: 'Facilities',
        tenantId,
      },
    ],
  });

  // ── Contacts ───────────────────────────────────────────────────────
  console.log('[seed-demo] Creating contacts...');
  const contacts = await prisma.$transaction([
    prisma.contact.create({
      data: {
        id: 'c-acme',
        firstName: 'Jane',
        lastName: 'Harper',
        email: 'jane.harper@acme.example.com',
        phone: '+1-555-0101',
        company: 'Acme Corp',
        jobTitle: 'Procurement Lead',
        status: 'Customer',
        userId: staffS1.id,
        tenantId,
      },
    }),
    prisma.contact.create({
      data: {
        id: 'c-northstar',
        firstName: 'Marcus',
        lastName: 'Chen',
        email: 'marcus.chen@northstar.example.com',
        phone: '+1-555-0102',
        company: 'Northstar Industries',
        jobTitle: 'CFO',
        status: 'Customer',
        userId: staffS2.id,
        tenantId,
      },
    }),
    prisma.contact.create({
      data: {
        id: 'c-atlas',
        firstName: 'Aisha',
        lastName: 'Okoye',
        email: 'aisha.okoye@atlas.example.com',
        phone: '+1-555-0103',
        company: 'Atlas Logistics',
        jobTitle: 'Operations Director',
        status: 'Customer',
        userId: staffS1.id,
        tenantId,
      },
    }),
    prisma.contact.create({
      data: {
        id: 'c-vertex',
        firstName: 'Tom',
        lastName: 'Müller',
        email: 'tom.muller@vertex.example.com',
        phone: '+1-555-0104',
        company: 'Vertex Solutions',
        jobTitle: 'IT Director',
        status: 'Lead',
        userId: staffS2.id,
        tenantId,
      },
    }),
  ]);

  // ── Deals ──────────────────────────────────────────────────────────
  console.log('[seed-demo] Creating deals...');
  await prisma.deal.createMany({
    data: [
      {
        name: 'Acme Annual Contract',
        contactId: 'c-acme',
        amount: 85000,
        status: DealStatus.WON,
        closeDate: new Date('2026-09-15'),
        userId: staffS1.id,
        tenantId,
      },
      {
        name: 'Northstar Platform Upgrade',
        contactId: 'c-northstar',
        amount: 125000,
        status: DealStatus.NEGOTIATION,
        closeDate: new Date('2026-11-01'),
        userId: staffS2.id,
        tenantId,
      },
      {
        name: 'Atlas Fleet Management',
        contactId: 'c-atlas',
        amount: 62000,
        status: DealStatus.QUALIFIED,
        closeDate: new Date('2026-11-15'),
        userId: staffS1.id,
        tenantId,
      },
      {
        name: 'Vertex Integration Pilot',
        contactId: 'c-vertex',
        amount: 18000,
        status: DealStatus.LEAD,
        closeDate: new Date('2026-12-01'),
        userId: staffS2.id,
        tenantId,
      },
    ],
  });

  // ── Invoices & Payments ────────────────────────────────────────────
  console.log('[seed-demo] Creating invoices and payments...');
  await prisma.invoice.createMany({
    data: [
      {
        id: 'inv-001',
        invoiceNumber: 'INV-2026-001',
        customerId: 'c-acme',
        amount: 85000,
        status: 'Paid',
        dueDate: new Date('2026-10-01'),
        paidDate: new Date('2026-09-20'),
        tenantId,
      },
      {
        id: 'inv-002',
        invoiceNumber: 'INV-2026-002',
        customerId: 'c-northstar',
        amount: 42000,
        status: 'Pending',
        dueDate: new Date('2026-11-05'),
        tenantId,
      },
      {
        id: 'inv-003',
        invoiceNumber: 'INV-2026-003',
        customerId: 'c-atlas',
        amount: 31000,
        status: 'Pending',
        dueDate: new Date('2026-10-28'),
        tenantId,
      },
      {
        id: 'inv-004',
        invoiceNumber: 'INV-2026-004',
        customerId: 'c-acme',
        amount: 15000,
        status: 'Paid',
        dueDate: new Date('2026-08-15'),
        paidDate: new Date('2026-08-12'),
        tenantId,
      },
    ],
  });

  await prisma.payment.createMany({
    data: [
      {
        invoiceId: 'inv-001',
        amount: 85000,
        paidAt: new Date('2026-09-20'),
        method: 'Wire Transfer',
        tenantId,
      },
      {
        invoiceId: 'inv-004',
        amount: 15000,
        paidAt: new Date('2026-08-12'),
        method: 'ACH',
        tenantId,
      },
    ],
  });

  // ── Expenses ───────────────────────────────────────────────────────
  console.log('[seed-demo] Creating expenses...');
  const financeDeptId = deptByType.get(DepartmentType.FINANCE)!.id;
  const itDeptId = deptByType.get(DepartmentType.INFORMATION_TECHNOLOGY)!.id;
  const hrDeptId = deptByType.get(DepartmentType.HUMAN_RESOURCES)!.id;
  const salesDeptId = deptByType.get(DepartmentType.SALES)!.id;

  await prisma.expense.createMany({
    data: [
      {
        description: 'AWS Infrastructure',
        amount: 12500,
        category: 'Cloud',
        incurredAt: new Date('2026-09-05'),
        departmentId: itDeptId,
        userId: hodIT.id,
        tenantId,
      },
      {
        description: 'Software Subscriptions',
        amount: 8400,
        category: 'Licenses',
        incurredAt: new Date('2026-09-10'),
        departmentId: itDeptId,
        userId: staffIT1.id,
        tenantId,
      },
      {
        description: 'Sales Conference Travel',
        amount: 6200,
        category: 'Travel',
        incurredAt: new Date('2026-09-18'),
        departmentId: salesDeptId,
        userId: leadSales.id,
        tenantId,
      },
      {
        description: 'Recruitment Ads',
        amount: 4500,
        category: 'Hiring',
        incurredAt: new Date('2026-09-22'),
        departmentId: hrDeptId,
        userId: hodHR.id,
        tenantId,
      },
      {
        description: 'Office Supplies',
        amount: 2800,
        category: 'Supplies',
        incurredAt: new Date('2026-10-03'),
        departmentId: financeDeptId,
        userId: hodFinance.id,
        tenantId,
      },
      {
        description: 'Security Audit',
        amount: 9500,
        category: 'Consulting',
        incurredAt: new Date('2026-10-08'),
        departmentId: itDeptId,
        userId: hodIT.id,
        tenantId,
      },
    ],
  });

  // ── Projects & Tasks ───────────────────────────────────────────────
  console.log('[seed-demo] Creating projects and tasks...');
  const projects = await prisma.$transaction([
    prisma.project.create({
      data: {
        id: 'proj-crm-v2',
        name: 'CRM Platform v2',
        description: 'Next-generation CRM redesign and migration',
        status: 'In Progress',
        startDate: new Date('2026-07-01'),
        budget: 250000,
        priority: 5,
        userId: leadIT.id,
        tenantId,
      },
    }),
    prisma.project.create({
      data: {
        id: 'proj-onboard',
        name: 'Customer Onboarding Revamp',
        description: 'Streamline the client onboarding workflow',
        status: 'Planning',
        startDate: new Date('2026-10-01'),
        budget: 45000,
        priority: 3,
        userId: leadCS.id,
        tenantId,
      },
    }),
    prisma.project.create({
      data: {
        id: 'proj-sales-playbook',
        name: 'Sales Playbook 2027',
        description: 'Update sales collateral and qualification framework',
        status: 'In Progress',
        startDate: new Date('2026-08-15'),
        budget: 20000,
        priority: 2,
        userId: leadSales.id,
        tenantId,
      },
    }),
  ]);

  await prisma.projectMember.createMany({
    data: [
      { projectId: 'proj-crm-v2', userId: leadIT.id, role: 'Lead', tenantId },
      { projectId: 'proj-crm-v2', userId: staffIT1.id, role: 'Developer', tenantId },
      { projectId: 'proj-crm-v2', userId: staffIT2.id, role: 'Developer', tenantId },
      { projectId: 'proj-onboard', userId: leadCS.id, role: 'Lead', tenantId },
      { projectId: 'proj-onboard', userId: staffCS1.id, role: 'Member', tenantId },
      { projectId: 'proj-onboard', userId: staffCS2.id, role: 'Member', tenantId },
      { projectId: 'proj-sales-playbook', userId: leadSales.id, role: 'Lead', tenantId },
      { projectId: 'proj-sales-playbook', userId: staffS1.id, role: 'Member', tenantId },
      { projectId: 'proj-sales-playbook', userId: staffS2.id, role: 'Member', tenantId },
    ],
  });

  await prisma.task.createMany({
    data: [
      {
        title: 'Implement API Gateway',
        description: 'Build the tenant-aware API gateway',
        status: 'Completed',
        priority: 5,
        dueDate: new Date('2026-09-20'),
        projectId: 'proj-crm-v2',
        assignedToId: staffIT1.id,
        tenantId,
      },
      {
        title: 'Design RBAC Matrix',
        description: 'Finalize permission resolution logic',
        status: 'In Progress',
        priority: 5,
        dueDate: new Date('2026-10-25'),
        projectId: 'proj-crm-v2',
        assignedToId: staffIT2.id,
        tenantId,
      },
      {
        title: 'Write Migration Scripts',
        description: 'Create tenant-scoped migration tooling',
        status: 'Todo',
        priority: 4,
        dueDate: new Date('2026-11-05'),
        projectId: 'proj-crm-v2',
        assignedToId: staffIT1.id,
        tenantId,
      },
      {
        title: 'Build Onboarding Checklist',
        description: 'Design the customer onboarding flow',
        status: 'In Progress',
        priority: 3,
        dueDate: new Date('2026-10-28'),
        projectId: 'proj-onboard',
        assignedToId: staffCS1.id,
        tenantId,
      },
      {
        title: 'Create Playbook Templates',
        description: 'Draft qualification and objection templates',
        status: 'Completed',
        priority: 2,
        dueDate: new Date('2026-09-30'),
        projectId: 'proj-sales-playbook',
        assignedToId: staffS1.id,
        tenantId,
      },
      {
        title: 'Update Pricing Sheets',
        description: 'Refresh 2027 pricing matrix',
        status: 'Todo',
        priority: 3,
        dueDate: new Date('2026-11-10'),
        projectId: 'proj-sales-playbook',
        assignedToId: staffS2.id,
        tenantId,
      },
    ],
  });

  // ── Support Tickets ────────────────────────────────────────────────
  console.log('[seed-demo] Creating support tickets...');
  await prisma.supportTicket.createMany({
    data: [
      {
        subject: 'SSO Login Failing',
        description: 'Users cannot log in via SSO',
        status: TicketStatus.IN_PROGRESS,
        priority: 5,
        contactId: 'c-northstar',
        userId: staffIT1.id,
        tenantId,
        slaDueDate: new Date('2026-10-25'),
      },
      {
        subject: 'Invoice Export Broken',
        description: 'CSV export returns empty file',
        status: TicketStatus.OPEN,
        priority: 3,
        contactId: 'c-acme',
        userId: staffCS1.id,
        tenantId,
        slaDueDate: new Date('2026-10-28'),
      },
      {
        subject: 'API Rate Limit Question',
        description: 'Clarify rate limiting for integrations',
        status: TicketStatus.RESOLVED,
        priority: 2,
        contactId: 'c-atlas',
        userId: staffCS2.id,
        tenantId,
        resolvedAt: new Date('2026-10-15'),
        slaDueDate: new Date('2026-10-18'),
      },
      {
        subject: 'Data Sync Delay',
        description: 'Reports showing stale data',
        status: TicketStatus.CLOSED,
        priority: 4,
        contactId: 'c-vertex',
        userId: staffIT2.id,
        tenantId,
        resolvedAt: new Date('2026-10-10'),
        slaDueDate: new Date('2026-10-12'),
      },
    ],
  });

  // ── Notifications ──────────────────────────────────────────────────
  console.log('[seed-demo] Creating notifications...');
  await prisma.notification.createMany({
    data: [
      {
        title: 'Security Alert',
        message: 'Unusual login attempt detected from new location',
        type: 'security',
        read: false,
        userId: hodIT.id,
        tenantId,
      },
      {
        title: 'Backup Failed',
        message: 'Nightly backup job failed - requires attention',
        type: 'error',
        read: false,
        userId: hodIT.id,
        tenantId,
      },
      {
        title: 'Invoice Overdue',
        message: 'INV-2026-003 is due in 3 days and not yet paid',
        type: 'warning',
        read: false,
        userId: hodFinance.id,
        tenantId,
      },
      {
        title: 'Budget Review',
        message: 'Q4 budget review meeting scheduled for Friday',
        type: 'info',
        read: true,
        userId: hodFinance.id,
        tenantId,
      },
    ],
  });

  // ── Attendance ─────────────────────────────────────────────────────
  console.log('[seed-demo] Creating attendance records...');
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  await prisma.attendanceRecord.createMany({
    data: [
      { userId: staffF1.id, date: today, status: 'Present', tenantId },
      { userId: staffF2.id, date: today, status: 'Present', tenantId },
      { userId: staffIT1.id, date: today, status: 'Present', tenantId },
      { userId: staffIT2.id, date: today, status: 'On Leave', tenantId },
      { userId: staffHR1.id, date: today, status: 'Present', tenantId },
      { userId: staffS1.id, date: today, status: 'Present', tenantId },
      { userId: staffS2.id, date: today, status: 'Absent', tenantId },
      { userId: staffCS1.id, date: today, status: 'Present', tenantId },
      { userId: staffA1.id, date: today, status: 'Present', tenantId },
      { userId: staffO1.id, date: today, status: 'Present', tenantId },

      { userId: staffF1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffF2.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffIT1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffIT2.id, date: yesterday, status: 'On Leave', tenantId },
      { userId: staffHR1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffS1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffS2.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffCS1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffA1.id, date: yesterday, status: 'Present', tenantId },
      { userId: staffO1.id, date: yesterday, status: 'Present', tenantId },

      { userId: staffF1.id, date: twoDaysAgo, status: 'Present', tenantId },
      { userId: staffIT1.id, date: twoDaysAgo, status: 'Present', tenantId },
      { userId: staffS1.id, date: twoDaysAgo, status: 'Present', tenantId },
      { userId: staffCS2.id, date: twoDaysAgo, status: 'Present', tenantId },
      { userId: staffA2.id, date: twoDaysAgo, status: 'Present', tenantId },

      { userId: staffHR2.id, date: threeDaysAgo, status: 'Present', tenantId },
      { userId: staffO2.id, date: threeDaysAgo, status: 'Present', tenantId },
    ],
  });

  // ── Assign department members (ensures departmentId is set) ────────
  console.log('[seed-demo] Ensuring department assignments...');
  const setDept = async (email: string, type: DepartmentType) => {
    const user = userByEmail.get(email)!;
    const dept = deptByType.get(type)!;
    await prisma.user.update({
      where: { id: user.id },
      data: { departmentId: dept.id },
    });
  };

  await Promise.all([
    setDept('hod.finance@claspcrm.com', DepartmentType.FINANCE),
    setDept('lead.finance@claspcrm.com', DepartmentType.FINANCE),
    setDept('staff1.finance@claspcrm.com', DepartmentType.FINANCE),
    setDept('staff2.finance@claspcrm.com', DepartmentType.FINANCE),
    setDept('hod.information_technology@claspcrm.com', DepartmentType.INFORMATION_TECHNOLOGY),
    setDept('lead.information_technology@claspcrm.com', DepartmentType.INFORMATION_TECHNOLOGY),
    setDept('staff1.information_technology@claspcrm.com', DepartmentType.INFORMATION_TECHNOLOGY),
    setDept('staff2.information_technology@claspcrm.com', DepartmentType.INFORMATION_TECHNOLOGY),
    setDept('hod.human_resources@claspcrm.com', DepartmentType.HUMAN_RESOURCES),
    setDept('lead.human_resources@claspcrm.com', DepartmentType.HUMAN_RESOURCES),
    setDept('staff1.human_resources@claspcrm.com', DepartmentType.HUMAN_RESOURCES),
    setDept('staff2.human_resources@claspcrm.com', DepartmentType.HUMAN_RESOURCES),
    setDept('hod.sales@claspcrm.com', DepartmentType.SALES),
    setDept('lead.sales@claspcrm.com', DepartmentType.SALES),
    setDept('staff1.sales@claspcrm.com', DepartmentType.SALES),
    setDept('staff2.sales@claspcrm.com', DepartmentType.SALES),
    setDept('hod.customer_service@claspcrm.com', DepartmentType.CUSTOMER_SERVICE),
    setDept('lead.customer_service@claspcrm.com', DepartmentType.CUSTOMER_SERVICE),
    setDept('staff1.customer_service@claspcrm.com', DepartmentType.CUSTOMER_SERVICE),
    setDept('staff2.customer_service@claspcrm.com', DepartmentType.CUSTOMER_SERVICE),
    setDept('hod.accounting@claspcrm.com', DepartmentType.ACCOUNTING),
    setDept('lead.accounting@claspcrm.com', DepartmentType.ACCOUNTING),
    setDept('staff1.accounting@claspcrm.com', DepartmentType.ACCOUNTING),
    setDept('staff2.accounting@claspcrm.com', DepartmentType.ACCOUNTING),
    setDept('hod.operations@claspcrm.com', DepartmentType.OPERATIONS),
    setDept('lead.operations@claspcrm.com', DepartmentType.OPERATIONS),
    setDept('staff1.operations@claspcrm.com', DepartmentType.OPERATIONS),
    setDept('staff2.operations@claspcrm.com', DepartmentType.OPERATIONS),
    setDept('hod.administration@claspcrm.com', DepartmentType.ADMINISTRATION),
    setDept('lead.administration@claspcrm.com', DepartmentType.ADMINISTRATION),
    setDept('staff1.administration@claspcrm.com', DepartmentType.ADMINISTRATION),
    setDept('staff2.administration@claspcrm.com', DepartmentType.ADMINISTRATION),
  ]);

  console.log('[seed-demo] Demo data created successfully.');
}

main()
  .catch((e) => {
    console.error('[seed-demo] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
