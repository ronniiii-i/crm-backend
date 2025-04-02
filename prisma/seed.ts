import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

async function seed() {
  try {
    console.log('🌱 Starting seeding...');

    // Create admin user with a project and task
    const admin = await prisma.user.create({
      data: {
        email: 'admin@crm.com',
        password: await hashPassword('admin123'),
        name: 'Admin User',
        role: 'ADMIN',
        projects: {
          create: {
            name: 'Launch CRM',
            description: 'Initial project to set up the CRM system',
            status: 'ACTIVE',
            tasks: {
              create: [
                {
                  title: 'Implement authentication',
                  description: 'Set up JWT auth with role-based access',
                  priority: 'HIGH',
                  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
                },
                {
                  title: 'Create database schema',
                  description: 'Design and implement Prisma schema',
                  priority: 'MEDIUM',
                },
              ],
            },
          },
        },
      },
      include: {
        projects: {
          include: {
            tasks: true,
          },
        },
      },
    });

    // Create sample contact
    await prisma.contact.create({
      data: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        company: 'ACME Corp',
        createdBy: {
          connect: { id: admin.id },
        },
      },
    });

    console.log('✅ Seeding completed successfully!');
    console.log(`👤 Admin user created with email: ${admin.email}`);
    console.log(`📊 ${admin.projects.length} projects created`);
    console.log(
      `✅ ${admin.projects[0].tasks.length} tasks added to first project`,
    );
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
