import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CoreModule } from '../core/core.module';

@Module({
  imports: [AuthModule, CoreModule],
  controllers: [ProjectsController],
  providers: [PrismaService],
})
export class ProjectsModule {}
