/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PrismaClient, Role } from '@prisma/client';
// import { DepartmentType } from '@prisma/client'; // Ensure proper import
import { hash } from 'bcryptjs';

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
  // Hash passwords
  const defaultPassword = await hash('password123', 12);
  // 1. Create admin user (won't be assigned as department manager)
  const admin = await prisma.user.create({
    data: {
      email: 'admin@crm.com',
      password: await hash('admin123', 12),
      name: 'System Admin',
      role: Role.ADMIN,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=1',
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      email: 'test@crm.com',
      password: await hash('test123', 12),
      name: 'test',
      role: Role.ADMIN,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=11',
    },
  });
  // 2. Create departments without managers first
  const departments = await Promise.all([
    prisma.department.create({
      data: {
        name: 'Administration',
        description: 'Company administration',
        type: 'ADMINISTRATION',
      },
    }),
    prisma.department.create({
      data: {
        name: 'Human Resources',
        description: 'HR department',
        type: 'HUMAN_RESOURCES',
      },
    }),
    prisma.department.create({
      data: {
        name: 'Sales',
        description: 'Sales and marketing',
        type: 'SALES',
      },
    }),
    prisma.department.create({
      data: {
        name: 'Operations',
        description: 'Business operations',
        type: 'OPERATIONS',
      },
    }),
    prisma.department.create({
      data: {
        name: 'Finance',
        description: 'Financial department',
        type: 'FINANCE',
      },
    }),
    prisma.department.create({
      data: {
        name: 'IT',
        description: 'Information technology',
        type: 'INFORMATION_TECHNOLOGY',
      },
    }),
    prisma.department.create({
      data: {
        name: 'Customer Service',
        description: 'Customer support',
        type: 'CUSTOMER_SERVICE',
      },
    }),
  ]);
  // 3. Create department managers and assign them
  const [hrManager, salesManager, opsManager, financeManager, itManager] =
    await Promise.all([
      prisma.user.create({
        data: {
          email: 'hr.hod@example.com',
          password: defaultPassword,
          name: 'Jane Smith',
          role: Role.HOD,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=2',
          department: { connect: { id: departments[1].id } }, // HR
        },
      }),
      prisma.user.create({
        data: {
          email: 'sales.hod@example.com',
          password: defaultPassword,
          name: 'Mike Johnson',
          role: Role.HOD,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=3',
          department: { connect: { id: departments[2].id } }, // Sales
        },
      }),
      prisma.user.create({
        data: {
          email: 'ops.hod@example.com',
          password: defaultPassword,
          name: 'Sarah Williams',
          role: Role.HOD,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=4',
          department: { connect: { id: departments[3].id } }, // Operations
        },
      }),
      prisma.user.create({
        data: {
          email: 'finance.hod@example.com',
          password: defaultPassword,
          name: 'David Brown',
          role: Role.HOD,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=5',
          department: { connect: { id: departments[4].id } }, // Finance
        },
      }),
      prisma.user.create({
        data: {
          email: 'it.hod@example.com',
          password: defaultPassword,
          name: 'Alex Chen',
          role: Role.HOD,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=6',
          department: { connect: { id: departments[5].id } }, // IT
        },
      }),
    ]);
  // 4. Update departments with their managers
  await Promise.all([
    prisma.department.update({
      where: { id: departments[1].id }, // HR
      data: { managerId: hrManager.id },
    }),
    prisma.department.update({
      where: { id: departments[2].id }, // Sales
      data: { managerId: salesManager.id },
    }),
    prisma.department.update({
      where: { id: departments[3].id }, // Operations
      data: { managerId: opsManager.id },
    }),
    prisma.department.update({
      where: { id: departments[4].id }, // Finance
      data: { managerId: financeManager.id },
    }),
    prisma.department.update({
      where: { id: departments[5].id }, // IT
      data: { managerId: itManager.id },
    }),
  ]);

  const [hrUser, salesUser, opsUser, financeUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'hr.staff@example.com',
        password: defaultPassword,
        name: 'Emily Davis',
        role: Role.STAFF,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=7',
        department: { connect: { id: departments[1].id } }, // HR
      },
    }),
    prisma.user.create({
      data: {
        email: 'sales.staff@example.com',
        password: defaultPassword,
        name: 'Robert Wilson',
        role: Role.STAFF,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=8',
        department: { connect: { id: departments[2].id } }, // Sales
      },
    }),
    prisma.user.create({
      data: {
        email: 'ops.staff@example.com',
        password: defaultPassword,
        name: 'Lisa Taylor',
        role: Role.STAFF,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=9',
        department: { connect: { id: departments[3].id } }, // Operations
      },
    }),
    prisma.user.create({
      data: {
        email: 'finance.staff@example.com',
        password: defaultPassword,
        name: 'Michael Scott',
        role: Role.STAFF,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=10',
        department: { connect: { id: departments[4].id } }, // Finance
      },
    }),
  ]);
  // 6. Create sample projects and tasks
  const salesProject = await prisma.project.create({
    data: {
      name: 'Sales Portal Redesign',
      description: 'Redesign of customer sales portal',
      status: 'Active',
      userId: salesManager.id,
      teamMembers: {
        create: [
          { userId: salesManager.id, role: 'Manager' },
          { userId: salesUser.id, role: 'Member' },
          { userId: salesUser?.id, role: 'Member' },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      title: 'Design wireframes',
      description: 'Create initial wireframes for new portal',
      status: 'In Progress',
      projectId: salesProject.id,
      assignedToId: salesUser?.id,
    },
  });

  await seedDashboardData();

  console.log('Database seeded successfully!');
}

seedDashboardData()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
