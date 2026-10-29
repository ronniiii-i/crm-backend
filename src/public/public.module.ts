import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { InvitationsModule } from '../invitations/invitations.module';
import { TenantResolverService } from '../tenant/tenant-resolver.service';
import { TenantProvisioningService } from '../tenant/tenant-provisioning.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [InvitationsModule, PrismaModule, JwtModule],
  controllers: [PublicController],
  providers: [
    PublicService,
    TenantResolverService,
    TenantProvisioningService,
    MailService,
  ],
})
export class PublicModule {}
