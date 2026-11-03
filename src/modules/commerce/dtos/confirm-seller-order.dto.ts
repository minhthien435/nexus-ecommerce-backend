import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmSellerOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
