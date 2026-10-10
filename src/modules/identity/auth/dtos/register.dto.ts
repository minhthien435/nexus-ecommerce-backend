import {
  IsEmail,
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
export class RegisterDto {
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullName: string;

  @IsOptional()
  @Matches(/^[0-9]{10}$/, {
    message: 'Số điện thoại phải bao gồm đúng 10 chữ số',
  })
  phone?: string;
}
