import { IsNotEmpty, IsString } from 'class-validator';
import { GuestCartInputDto } from './guest-cart-item.dto.js';

export class GoogleLoginDto extends GuestCartInputDto {
  @IsString()
  @IsNotEmpty({ message: 'Google credential không được để trống' })
  credential: string;
}
