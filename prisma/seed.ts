// prisma/seed.ts

import { PrismaClient, DepartmentType, Role } from '@prisma/client';
import { ALL_ROUTES } from 'src/auth/routes';

const prisma = new PrismaClient();

async function seedDashboardData() {
  // Find Finance and Sales departments and users for relations
  const financeDept = await prisma.department.findFirst({
    where: { name: 'Finance' },
  });
  const salesDept = await prisma.department.findFirst({
    where: { name: 'Sales' },
  });

  const financeStaff = await prisma.user.findUnique({
    where: { email: 'finance.staff@example.com' },
  });
  const salesStaff = await prisma.user.findUnique({
    where: { email: 'sales.staff@example.com' },
  });

  // 1. Seed Invoices and Payments (Revenue)
  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-1001',
      customer: {
        create: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          createdBy: {
            connect: { email: 'admin@crm.com' },
          }, // Connects to the admin user by email
        },
      },
      amount: 5000,
      status: 'Paid',
      dueDate: new Date('2024-05-01'),
      paidDate: new Date('2024-04-25'),
      createdAt: new Date('2024-04-01'),
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: invoice1.id,
      amount: 5000,
      paidAt: new Date('2024-04-25'),
      method: 'Credit Card',
    },
  });

  // 2. Seed Expenses
  if (financeDept && financeStaff) {
    await prisma.expense.createMany({
      data: [
        {
          description: 'Office Supplies',
          amount: 200,
          category: 'Supplies',
          incurredAt: new Date('2024-04-10'),
          departmentId: financeDept.id,
          userId: financeStaff.id,
          createdAt: new Date(),
        },
        {
          description: 'Travel Expenses',
          amount: 1500,
          category: 'Travel',
          incurredAt: new Date('2024-04-15'),
          departmentId: financeDept.id,
          userId: financeStaff.id,
          createdAt: new Date(),
        },
      ],
    });
  }

  // 3. Seed Deals (Sales Pipeline)
  if (salesDept && salesStaff) {
    await prisma.deal.createMany({
      data: [
        {
          name: 'Deal A',
          contactId: invoice1.customerId,
          amount: 10000,
          status: 'LEAD',
          userId: salesStaff.id,
          createdAt: new Date('2024-04-01'),
        },
        {
          name: 'Deal B',
          contactId: invoice1.customerId,
          amount: 25000,
          status: 'PROPOSAL',
          userId: salesStaff.id,
          createdAt: new Date('2024-04-05'),
        },
        {
          name: 'Deal C',
          contactId: invoice1.customerId,
          amount: 40000,
          status: 'WON',
          userId: salesStaff.id,
          createdAt: new Date('2024-03-20'),
        },
      ],
    });
  }

  // 4. Seed Support Tickets
  if (salesStaff) {
    await prisma.supportTicket.createMany({
      data: [
        {
          subject: 'Issue with invoice',
          status: 'OPEN',
          priority: 2,
          contactId: invoice1.customerId,
          userId: salesStaff.id,
          createdAt: new Date('2024-04-20'),
        },
        {
          subject: 'Payment not reflected',
          status: 'RESOLVED',
          priority: 1,
          contactId: invoice1.customerId,
          userId: salesStaff.id,
          createdAt: new Date('2024-04-10'),
          resolvedAt: new Date('2024-04-12'),
        },
      ],
    });
  }

  // 5. Seed Attendance Records (last 30 days) for financeStaff
  if (financeStaff) {
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      await prisma.attendanceRecord.create({
        data: {
          userId: financeStaff.id,
          date,
          status: i % 7 === 0 ? 'Absent' : 'Present',
        },
      });
    }
  }

  // 6. Seed Security Alerts (Notifications)
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@crm.com' },
  });
  if (adminUser) {
    await prisma.notification.createMany({
      data: [
        {
          title: 'Multiple failed login attempts',
          message:
            '5 failed login attempts detected for user finance.staff@example.com',
          read: false,
          type: 'security',
          userId: adminUser.id,
          createdAt: new Date(),
        },
        {
          title: 'New device login',
          message: 'User admin@crm.com logged in from a new device',
          read: false,
          type: 'security',
          userId: adminUser.id,
          createdAt: new Date(),
        },
      ],
    });
  }

  // 7. (Optional) Seed Quick Actions if model exists
  const quickActionModelExists = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE tablename = 'QuickAction'`;

  if (quickActionModelExists.length > 0) {
    await prisma.quickAction.createMany({
      data: [
        {
          name: 'Reset User Password',
          description: 'Quickly reset a user password',
          command: 'resetPassword',
        },
        {
          name: 'Generate Financial Report',
          description: 'Generate monthly financial report',
          command: 'genFinancialReport',
        },
      ],
    });
  }
  console.log('Database data seeded successfully!');
}

async function main() {
  console.log('Start seeding...');

  // 1. Seed Permissions
  const permissionsData = [
    { type: 'VIEW' },
    { type: 'EDIT' },
    { type: 'DELETE' },
  ];
  await prisma.permission.createMany({
    data: permissionsData,
    skipDuplicates: true,
  });

  const viewPerm = await prisma.permission.findUnique({
    where: { type: 'VIEW' },
  });
  const editPerm = await prisma.permission.findUnique({
    where: { type: 'EDIT' },
  });
  const deletePerm = await prisma.permission.findUnique({
    where: { type: 'DELETE' },
  });

  console.log('Permissions seeded.');

  // 2. Seed Modules and RoleModulePermissions
  for (const route of ALL_ROUTES) {
    // Insert module data
    const module = await prisma.module.upsert({
      where: { path: route.path },
      update: {}, // No need to update on subsequent runs
      create: {
        id: route.id, // Use the existing ID from your route file
        name: route.name,
        path: route.path,
        icon: route.icon, // Assuming 'icon' is a field in your Module model
        department: route.department
          ? {
              connect: { type: route.department as DepartmentType }, // Adjust for array/single string
            }
          : undefined,
      },
    });

    // Handle department mapping (if department is an array)
    // You will need to add logic here to handle the `department: Department.HR, Department.ACCOUNTING` case from your `routes.ts` file.

    // Insert permissions for each role
    for (const role in route.permissions) {
      const allowedPermissions = route.permissions[role as Role];

      for (const permission of allowedPermissions) {
        let permissionId;
        if (permission === 'VIEW') permissionId = viewPerm.id;
        if (permission === 'EDIT') permissionId = editPerm.id;
        if (permission === 'DELETE') permissionId = deletePerm.id;

        if (permissionId) {
          await prisma.roleModulePermission.upsert({
            where: {
              role_moduleId_permissionId: {
                role: role as Role,
                moduleId: module.id,
                permissionId: permissionId,
              },
            },
            update: {},
            create: {
              role: role as Role,
              moduleId: module.id,
              permissionId: permissionId,
            },
          });
        }
      }
    }
  }

  console.log('Seeding finished.');
}

seedDashboardData()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
