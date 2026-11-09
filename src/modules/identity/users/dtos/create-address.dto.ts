import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsIn(['legacy', 'ghn_v3'])
  addressScheme?: 'legacy' | 'ghn_v3';

  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @IsString()
  @IsNotEmpty()
  provinceCode: string;

  @ValidateIf((dto: CreateAddressDto) => dto.addressScheme !== 'ghn_v3')
  @IsString()
  @IsNotEmpty()
  districtCode?: string;

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
