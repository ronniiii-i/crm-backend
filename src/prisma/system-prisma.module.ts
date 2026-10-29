import { Module } from '@nestjs/common';
import { SystemPrismaService } from './system-prisma.service';

@Module({
  providers: [SystemPrismaService],
  exports: [SystemPrismaService],
})
export class SystemPrismaModule {}
