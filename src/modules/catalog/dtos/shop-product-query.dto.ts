import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const SHOP_PRODUCT_SORTS = [
  'newest',
  'price_asc',
  'price_desc',
  'popular',
] as const;
export type ShopProductSort = (typeof SHOP_PRODUCT_SORTS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const number = ({ value }: { value: unknown }) =>
  value === '' || value === undefined ? undefined : Number(value);

export class ShopProductQueryDto {
  @IsOptional() @IsString() @MaxLength(200) @Transform(trim) keyword?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(100) @Transform(trim) brand?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Transform(number)
  minPrice?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Transform(number)
  maxPrice?: number;
  @IsOptional()
  @IsIn(SHOP_PRODUCT_SORTS)
  sort: ShopProductSort = 'newest';
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  page = 1;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => Number(value))
  limit = 20;
}
