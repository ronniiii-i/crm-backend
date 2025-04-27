import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { CoreModule } from '../core/core.module';

@Module({
  imports: [AuthModule, GuardsModule, CoreModule],
  controllers: [ProjectsController],
  providers: [PrismaService],
})
export class ProjectsModule {}
