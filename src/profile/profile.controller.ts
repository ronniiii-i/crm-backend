import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@User() user: { userId: string }) {
    return this.profileService.getProfile(user.userId);
  }

  @Patch()
  updateProfile(
    @User() user: { userId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(user.userId, dto);
  }
}
