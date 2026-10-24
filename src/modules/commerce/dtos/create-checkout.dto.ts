import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CustomShippingAddressDto {
  @IsString()
  @IsNotEmpty()
  recipientName: string;

  @IsString()
  @IsNotEmpty()
  recipientPhone: string;

  @IsString()
  @IsNotEmpty()
  addressLine: string;

  @IsOptional()
  @IsString()
  provinceCode?: string;

  @IsOptional()
  @IsString()
  districtCode?: string;

  @IsOptional()
  @IsString()
  wardCode?: string;
}

export class CreateCheckoutDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedCartItemIds?: string[];

  @IsOptional()
  @IsUUID('4')
  addressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomShippingAddressDto)
  shippingAddress?: CustomShippingAddressDto;

  @IsOptional()
  @IsIn(['STRIPE', 'COD'])
  paymentMethod?: 'STRIPE' | 'COD' = 'STRIPE';

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  buyerNote?: string;
}
