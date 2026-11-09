import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { FinalizeAvatarDto } from './dto/finalize-avatar.dto';

type SessionUser = { sub: string; userId?: string; tenantId: string };

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@User() user: SessionUser) {
    return this.profileService.getProfile(user.sub ?? user.userId!);
  }

  @Patch()
  updateProfile(@User() user: SessionUser, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(user.sub ?? user.userId!, dto);
  }

  @Patch('avatar')
  finalizeAvatar(@User() user: SessionUser, @Body() dto: FinalizeAvatarDto) {
    return this.profileService.finalizeAvatar(
      user.sub ?? user.userId!,
      user.tenantId,
      dto.key,
    );
  }

  @Delete('avatar')
  removeAvatar(@User() user: SessionUser) {
    return this.profileService.removeAvatar(
      user.sub ?? user.userId!,
      user.tenantId,
    );
  }
}
