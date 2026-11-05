// prisma/seed-demo.ts
//
// Phase 3 workspace seeds.
//
// Delegates to `prisma/seed/workspaces` so `npm run db:seed:demo` and
// `SEED_DEMO=true npm run db:seed` provision Acme Corp (rich demo) and
// Clean Slate Inc (templates only). The legacy `beta` tenant remains behind
// `SEED_LEGACY_BETA` (default true outside production, false in production)
// for compatibility.
//
// Usage:
//   npm run db:seed:demo
//   SEED_DEMO=true npm run db:seed
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedWorkspaces } from './seed/workspaces';

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  await seedWorkspaces(prisma);
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
    },
  });
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  try {
    await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Demo seed failed:', error);
    process.exitCode = 1;
  });
}
