import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, MailService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
