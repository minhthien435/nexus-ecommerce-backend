import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateAddressDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  recipientName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  provinceCode?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  districtCode?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  wardCode?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  addressLine?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{10}$/)
  recipientPhone?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isDefault?: boolean;
}
