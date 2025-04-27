// src/projects/projects.module.ts
import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
// import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module'; // Import AuthModule

@Module({
  imports: [AuthModule], // This gives access to all exported guards
  controllers: [ProjectsController],
  providers: [PrismaService],
})
export class ProjectsModule {}
