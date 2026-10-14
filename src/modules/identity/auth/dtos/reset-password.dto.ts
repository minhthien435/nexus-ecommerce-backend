import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '../password-policy.js';

export class ResetPasswordDto {
  @IsString({ message: 'Reset token phải là chuỗi' })
  @IsNotEmpty({ message: 'Reset token không được để trống' })
  resetToken: string;

  @IsString({ message: 'Mật khẩu mới phải là chuỗi' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;

  @IsOptional()
  @IsString({ message: 'Xác nhận mật khẩu phải là chuỗi' })
  confirmPassword?: string;
}
