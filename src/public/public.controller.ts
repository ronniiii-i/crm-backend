import { Controller, Get, Post, Body, Param, Headers } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { InvitationsService } from '../invitations/invitations.service';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly publicService: PublicService,
  ) {}

  @Public()
  @Get('workspaces/:slug')
  getWorkspace(@Param('slug') slug: string) {
    return this.publicService.getWorkspace(slug);
  }

  @Public()
  @Post('workspaces')
  createWorkspace(@Body() body: any) {
    return this.publicService.createWorkspace(body);
  }

  @Public()
  @Post('contact')
  contact(@Body() body: any) {
    return this.publicService.contact(body);
  }

  @Public()
  @Get('invitations/:token')
  getInvitation(@Param('token') token: string, @Headers('x-tenant-slug') slug: string) {
    return this.invitationsService.getPublic(token, slug);
  }

  @Public()
  @Post('invitations/:token/accept')
  acceptInvitation(@Param('token') token: string, @Headers('x-tenant-slug') slug: string, @Body() body: any) {
    return this.invitationsService.accept(token, slug, body);
  }
}
