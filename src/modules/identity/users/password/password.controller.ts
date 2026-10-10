import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { ChangePasswordDto } from '../dtos/change-password.dto.js';
import { PasswordService } from './password.service.js';

@UseGuards(AccessTokenGuard)
@Controller('api/v1/users')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUserId() userId: string,
    @Body() input: ChangePasswordDto,
  ) {
    await this.passwords.changePassword(userId, input);
    return { message: 'Password changed successfully. Please sign in again' };
  }
}
