import { Controller, Get, Post, Body, Delete, Param, UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { User } from '../auth/decorators/user.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get()
  @RequirePermission('user-management', 'VIEW')
  list(@User() user: any) {
    return this.service.list(user.tenantId);
  }

  @Post()
  @RequirePermission('user-management', 'CREATE')
  create(@User() user: any, @Body() dto: CreateInvitationDto) {
    return this.service.create(user.tenantId, user, dto);
  }

  @Post(':id/resend')
  @RequirePermission('user-management', 'EDIT')
  resend(@User() user: any, @Param('id') id: string) {
    return this.service.resend(user.tenantId, user, id);
  }

  @Delete(':id')
  @RequirePermission('user-management', 'DELETE')
  revoke(@User() user: any, @Param('id') id: string) {
    return this.service.revoke(user.tenantId, id);
  }
}
