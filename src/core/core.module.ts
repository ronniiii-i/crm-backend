// src/core/core.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataFilterService } from './data-filter.service';
import { GuardsModule } from '../auth/guards.module'; // Import if needed

@Module({
  imports: [GuardsModule], // Optional if your DataFilterService needs guards
  providers: [PrismaService, DataFilterService],
  exports: [DataFilterService],
})
export class CoreModule {}
