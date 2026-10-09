import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @IsString()
  @IsNotEmpty()
  provinceCode: string;

  @IsString()
  @IsNotEmpty()
  districtCode: string;

  @IsString()
  @IsNotEmpty()
  wardCode: string;

  @IsString()
  @IsNotEmpty()
  addressLine: string;

  @IsString()
  @Matches(/^\d{10}$/)
  recipientPhone: string;

  @Transform(({ value }) => (value === undefined ? false : value))
  @IsBoolean()
  isDefault = false;
}
