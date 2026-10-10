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

@Controller('api/v1/auth')
@UseGuards(AccessTokenGuard)
export class CurrentProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('me')
  get(@CurrentUserId() userId: string) {
    return this.profiles.get(userId);
  }
}

@Controller('api/v1/users')
@UseGuards(AccessTokenGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Patch('profile')
  update(@CurrentUserId() userId: string, @Body() input: UpdateProfileDto) {
    if (
      input.fullName === undefined &&
      input.phone === undefined &&
      input.avatarUrl === undefined
    ) {
      throw new BadRequestException();
    }
    return this.profiles.update(userId, input);
  }
}
