/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
// prisma/seed.ts
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Hash passwords for all users
  const password = await hash('password123', 12);

  // Create admin user first since departments need a manager
  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password,
      name: 'System Admin',
      role: Role.ADMIN,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=1',
    },
  });

  // Create departments with admin as initial manager
  const adminDept = await prisma.department.create({
    data: {
      name: 'Administration',
      description: 'Company administration',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const hrDept = await prisma.department.create({
    data: {
      name: 'Human Resources',
      description: 'HR department',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const salesDept = await prisma.department.create({
    data: {
      name: 'Sales',
      description: 'Sales and marketing',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const opsDept = await prisma.department.create({
    data: {
      name: 'Operations',
      description: 'Business operations',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const financeDept = await prisma.department.create({
    data: {
      name: 'Finance',
      description: 'Financial department',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const itDept = await prisma.department.create({
    data: {
      name: 'IT',
      description: 'Information technology',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  const customerServiceDept = await prisma.department.create({
    data: {
      name: 'Customer Service',
      description: 'Customer support',
      managerId: admin.id,
      members: {
        connect: { id: admin.id },
      },
    },
  });

  // Create HR Manager and connect to department
  const hrManager = await prisma.user.create({
    data: {
      email: 'hr.manager@example.com',
      password,
      name: 'Jane Smith',
      role: Role.MANAGER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=2',
      departments: {
        connect: { id: hrDept.id },
      },
    },
  });

  // Update HR department with real manager
  await prisma.department.update({
    where: { id: hrDept.id },
    data: {
      managerId: hrManager.id,
      members: {
        connect: { id: hrManager.id },
      },
    },
  });

  // Create Sales Manager
  const salesManager = await prisma.user.create({
    data: {
      email: 'sales.manager@example.com',
      password,
      name: 'Mike Johnson',
      role: Role.MANAGER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=3',
      departments: {
        connect: { id: salesDept.id },
      },
    },
  });

  await prisma.department.update({
    where: { id: salesDept.id },
    data: {
      managerId: salesManager.id,
      members: {
        connect: { id: salesManager.id },
      },
    },
  });

  // Create Ops Manager
  const opsManager = await prisma.user.create({
    data: {
      email: 'ops.manager@example.com',
      password,
      name: 'Sarah Williams',
      role: Role.MANAGER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=4',
      departments: {
        connect: { id: opsDept.id },
      },
    },
  });

  await prisma.department.update({
    where: { id: opsDept.id },
    data: {
      managerId: opsManager.id,
      members: {
        connect: { id: opsManager.id },
      },
    },
  });

  // Create Finance Manager
  const financeManager = await prisma.user.create({
    data: {
      email: 'finance.manager@example.com',
      password,
      name: 'David Brown',
      role: Role.MANAGER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=5',
      departments: {
        connect: { id: financeDept.id },
      },
    },
  });

  await prisma.department.update({
    where: { id: financeDept.id },
    data: {
      managerId: financeManager.id,
      members: {
        connect: { id: financeManager.id },
      },
    },
  });

  // Create IT Manager
  const itManager = await prisma.user.create({
    data: {
      email: 'it.manager@example.com',
      password,
      name: 'Alex Chen',
      role: Role.MANAGER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=6',
      departments: {
        connect: { id: itDept.id },
      },
    },
  });

  await prisma.department.update({
    where: { id: itDept.id },
    data: {
      managerId: itManager.id,
      members: {
        connect: { id: itManager.id },
      },
    },
  });

  // Create regular users
  const hrUser = await prisma.user.create({
    data: {
      email: 'hr.user@example.com',
      password,
      name: 'Emily Davis',
      role: Role.USER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=7',
      departments: {
        connect: { id: hrDept.id },
      },
    },
  });

  const salesUser = await prisma.user.create({
    data: {
      email: 'sales.user@example.com',
      password,
      name: 'Robert Wilson',
      role: Role.USER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=8',
      departments: {
        connect: { id: salesDept.id },
      },
    },
  });

  const opsUser = await prisma.user.create({
    data: {
      email: 'ops.user@example.com',
      password,
      name: 'Lisa Taylor',
      role: Role.USER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=9',
      departments: {
        connect: { id: opsDept.id },
      },
    },
  });

  const financeUser = await prisma.user.create({
    data: {
      email: 'finance.user@example.com',
      password,
      name: 'Michael Scott',
      role: Role.USER,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=10',
      departments: {
        connect: { id: financeDept.id },
      },
    },
  });

  // Create guest user (no department)
  const guestUser = await prisma.user.create({
    data: {
      email: 'guest@example.com',
      password,
      name: 'Guest User',
      role: Role.GUEST,
      isVerified: true,
      avatarUrl: 'https://picsum.photos/200/200?random=11',
    },
  });

  // Create sample projects
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
        ],
      },
    },
  });

  const opsProject = await prisma.project.create({
    data: {
      name: 'Inventory System Upgrade',
      description: 'Upgrade inventory management system',
      status: 'Planning',
      userId: opsManager.id,
      teamMembers: {
        create: [
          { userId: opsManager.id, role: 'Manager' },
          { userId: opsUser.id, role: 'Member' },
        ],
      },
    },
  });

  // Create sample tasks
  await prisma.task.create({
    data: {
      title: 'Design wireframes',
      description: 'Create initial wireframes for new portal',
      status: 'In Progress',
      projectId: salesProject.id,
      assignedToId: salesUser.id,
    },
  });

  await prisma.task.create({
    data: {
      title: 'Research inventory solutions',
      description: 'Evaluate potential inventory management solutions',
      status: 'Todo',
      projectId: opsProject.id,
      assignedToId: opsUser.id,
    },
  });

  // Create sample contacts
  await prisma.contact.create({
    data: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@client.com',
      company: 'Acme Inc',
      status: 'Customer',
      userId: salesManager.id,
      tags: ['VIP', 'Tech'],
    },
  });

  // Create sample inventory items
  await prisma.inventoryItem.create({
    data: {
      name: 'Laptop',
      description: 'Dell XPS 15',
      sku: 'LP-DXPS15-001',
      quantity: 10,
      minStock: 3,
      location: 'Warehouse A',
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
