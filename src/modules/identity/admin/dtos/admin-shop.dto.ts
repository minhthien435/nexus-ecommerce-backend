import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SHOP_STATUSES, type ShopStatus } from '../../domain/shop.entity.js';

export class ListShopsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(SHOP_STATUSES)
  status?: ShopStatus;

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

export class UpdateShopStatusDto {
  @IsIn(SHOP_STATUSES)
  status: ShopStatus;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
