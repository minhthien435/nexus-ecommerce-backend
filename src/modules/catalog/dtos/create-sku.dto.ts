import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { MIN_SKU_PRICE } from '../catalog-pricing.constants.js';
import { IsSkuAttributes } from './sku-attributes.validator.js';

export class CreateSkuDto {
  @IsSkuAttributes()
  attributes: Record<string, string>;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_SKU_PRICE, { message: 'Giá bán tối thiểu là 1.000₫' })
  price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_SKU_PRICE, { message: 'Giá gốc tối thiểu là 1.000₫' })
  originalPrice?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'Đơn vị tiền tệ phải gồm đúng 3 chữ cái',
  })
  currency?: string;

  @IsInt()
  @IsPositive()
  weightGrams: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  lengthCm: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  widthCm: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  heightCm: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
