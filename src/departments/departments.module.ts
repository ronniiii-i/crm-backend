import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentModulesController } from './department-modules.controller';
import { DepartmentsService } from './departments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [PrismaModule, AuthModule, WorkspaceModule],
  controllers: [DepartmentsController, DepartmentModulesController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
