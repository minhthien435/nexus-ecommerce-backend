import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { GuestCartInputDto } from './guest-cart-item.dto.js';
export class LoginDto extends GuestCartInputDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
