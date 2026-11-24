import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { UpdateProfileDto } from '../dtos/update-profile.dto.js';
import { ProfileService } from './profile.service.js';

@UseGuards(AccessTokenGuard)
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get(['api/v1/auth/me', 'api/v1/users/profile'])
  getProfile(@CurrentUserId() userId: string) {
    return this.profiles.getProfile(userId);
  }

  @Patch('api/v1/users/profile')
  updateProfile(
    @CurrentUserId() userId: string,
    @Body() input: UpdateProfileDto,
  ) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one update field is required');
    }
    return this.profiles.updateProfile(userId, input);
  }
}
