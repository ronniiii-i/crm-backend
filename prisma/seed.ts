// // prisma/seed.ts
// import { PrismaClient, Role } from '@prisma/client';
// import { hash } from 'bcryptjs';

// const prisma = new PrismaClient();

// async function main() {
//   // Clear existing data
//   await prisma.projectMember.deleteMany();
//   await prisma.projectFile.deleteMany();
//   await prisma.task.deleteMany();
//   await prisma.project.deleteMany();
//   await prisma.contact.deleteMany();
//   await prisma.department.deleteMany();
//   await prisma.user.deleteMany();

//   // Seed Users
//   const admin = await prisma.user.create({
//     data: {
//       email: 'admin@crm.com',
//       password: await hash('admin123', 12),
//       name: 'Admin User',
//       role: Role.ADMIN,
//       avatarUrl: 'https://i.pravatar.cc/150?img=1',
//     },
//   });

//   const manager = await prisma.user.create({
//     data: {
//       email: 'manager@crm.com',
//       password: await hash('manager123', 12),
//       name: 'Sales Manager',
//       role: Role.MANAGER,
//       avatarUrl: 'https://i.pravatar.cc/150?img=2',
//     },
//   });

//   const user1 = await prisma.user.create({
//     data: {
//       email: 'user1@crm.com',
//       password: await hash('user1123', 12),
//       name: 'John Doe',
//       role: Role.USER,
//       avatarUrl: 'https://i.pravatar.cc/150?img=3',
//     },
//   });

//   const user2 = await prisma.user.create({
//     data: {
//       email: 'user2@crm.com',
//       password: await hash('user2123', 12),
//       name: 'Jane Smith',
//       role: Role.USER,
//       avatarUrl: 'https://i.pravatar.cc/150?img=4',
//     },
//   });

//   // Seed Departments
//   const salesDept = await prisma.department.create({
//     data: {
//       name: 'Sales',
//       description: 'Sales and Customer Relations',
//       manager: { connect: { id: manager.id } },
//       members: {
//         connect: [{ id: manager.id }, { id: user1.id }],
//       },
//     },
//   });

//   const hrDept = await prisma.department.create({
//     data: {
//       name: 'HR',
//       description: 'Human Resources',
//       manager: { connect: { id: admin.id } },
//       members: {
//         connect: [{ id: admin.id }, { id: user2.id }],
//       },
//     },
//   });

//   // Seed Contacts
//   await prisma.contact.createMany({
//     data: [
//       {
//         firstName: 'Michael',
//         lastName: 'Johnson',
//         email: 'michael@client.com',
//         phone: '+15551234567',
//         company: 'Acme Corp',
//         jobTitle: 'CEO',
//         status: 'Customer',
//         userId: admin.id,
//         tags: ['VIP', 'Enterprise'],
//       },
//       {
//         firstName: 'Sarah',
//         lastName: 'Williams',
//         email: 'sarah@client.com',
//         phone: '+15559876543',
//         company: 'Globex Inc',
//         jobTitle: 'Purchasing Manager',
//         status: 'Lead',
//         userId: manager.id,
//         tags: ['Hot Lead'],
//       },
//     ],
//   });

//   // Seed Projects
//   const websiteProject = await prisma.project.create({
//     data: {
//       name: 'Website Redesign',
//       description: 'Complete overhaul of company website',
//       status: 'Active',
//       startDate: new Date('2023-06-01'),
//       endDate: new Date('2023-12-31'),
//       budget: 50000,
//       priority: 1,
//       userId: admin.id,
//       teamMembers: {
//         create: [
//           { userId: admin.id, role: 'Manager' },
//           { userId: user1.id, role: 'Developer' },
//         ],
//       },
//       tasks: {
//         create: [
//           {
//             title: 'Design Homepage',
//             description: 'Create new homepage layout',
//             status: 'In Progress',
//             priority: 1,
//             dueDate: new Date('2023-07-15'),
//             assignedToId: user1.id,
//           },
//           {
//             title: 'Content Migration',
//             description: 'Move all existing content to new CMS',
//             status: 'Todo',
//             priority: 2,
//             assignedToId: user2.id,
//           },
//         ],
//       },
//       files: {
//         create: [
//           {
//             name: 'Design Mockups',
//             url: 'https://example.com/files/mockups.pdf',
//             size: 2500000,
//             type: 'application/pdf',
//             userId: admin.id,
//           },
//         ],
//       },
//     },
//   });

//   // Seed Inventory
//   await prisma.inventoryItem.createMany({
//     data: [
//       {
//         name: 'Laptop',
//         description: 'Dell XPS 15',
//         sku: 'LP-DXPS15-001',
//         quantity: 10,
//         minStock: 2,
//         location: 'Warehouse A',
//       },
//       {
//         name: 'Monitor',
//         description: '27" 4K Display',
//         sku: 'MON-4K27-001',
//         quantity: 15,
//         minStock: 5,
//         location: 'Warehouse B',
//       },
//     ],
//   });

//   // Seed Notifications
//   await prisma.notification.createMany({
//     data: [
//       {
//         title: 'New Task Assigned',
//         message: 'You have been assigned to "Design Homepage"',
//         type: 'system',
//         userId: user1.id,
//       },
//       {
//         title: 'Project Update',
//         message: 'The "Website Redesign" project has been updated',
//         type: 'alert',
//         userId: admin.id,
//       },
//     ],
//   });

//   console.log('Database seeded successfully! 🌱');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
