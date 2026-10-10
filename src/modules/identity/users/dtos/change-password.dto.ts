import { IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '../../auth/password-policy.js';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}
