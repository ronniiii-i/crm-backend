/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PrismaClient, Role } from '@prisma/client';
// import { DepartmentType } from '@prisma/client'; // Ensure proper import
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

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
          email: 'hr.manager@example.com',
          password: defaultPassword,
          name: 'Jane Smith',
          role: Role.MANAGER,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=2',
          department: { connect: { id: departments[1].id } }, // HR
        },
      }),
      prisma.user.create({
        data: {
          email: 'sales.manager@example.com',
          password: defaultPassword,
          name: 'Mike Johnson',
          role: Role.MANAGER,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=3',
          department: { connect: { id: departments[2].id } }, // Sales
        },
      }),
      prisma.user.create({
        data: {
          email: 'ops.manager@example.com',
          password: defaultPassword,
          name: 'Sarah Williams',
          role: Role.MANAGER,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=4',
          department: { connect: { id: departments[3].id } }, // Operations
        },
      }),
      prisma.user.create({
        data: {
          email: 'finance.manager@example.com',
          password: defaultPassword,
          name: 'David Brown',
          role: Role.MANAGER,
          isVerified: true,
          avatarUrl: 'https://picsum.photos/200/200?random=5',
          department: { connect: { id: departments[4].id } }, // Finance
        },
      }),
      prisma.user.create({
        data: {
          email: 'it.manager@example.com',
          password: defaultPassword,
          name: 'Alex Chen',
          role: Role.MANAGER,
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
        email: 'hr.user@example.com',
        password: defaultPassword,
        name: 'Emily Davis',
        role: Role.USER,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=7',
        department: { connect: { id: departments[1].id } }, // HR
      },
    }),
    prisma.user.create({
      data: {
        email: 'sales.user@example.com',
        password: defaultPassword,
        name: 'Robert Wilson',
        role: Role.USER,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=8',
        department: { connect: { id: departments[2].id } }, // Sales
      },
    }),
    prisma.user.create({
      data: {
        email: 'ops.user@example.com',
        password: defaultPassword,
        name: 'Lisa Taylor',
        role: Role.USER,
        isVerified: true,
        avatarUrl: 'https://picsum.photos/200/200?random=9',
        department: { connect: { id: departments[3].id } }, // Operations
      },
    }),
    prisma.user.create({
      data: {
        email: 'finance.user@example.com',
        password: defaultPassword,
        name: 'Michael Scott',
        role: Role.USER,
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

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
