import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
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

export class ExpectedFlashDealDto {
  @IsUUID('4')
  cartItemId: string;

  @IsUUID('4')
  flashDealItemId: string;

  @IsString()
  @IsNotEmpty()
  expectedUnitPrice: string;
}

export class CreateCheckoutDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  useCoins?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpectedFlashDealDto)
  expectedFlashDeals?: ExpectedFlashDealDto[];

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
  @IsIn(['PAYOS', 'COD'])
  paymentMethod?: 'PAYOS' | 'COD' = 'PAYOS';

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
