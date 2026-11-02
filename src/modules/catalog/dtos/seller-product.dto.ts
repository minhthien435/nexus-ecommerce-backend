import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductStatus } from '../domain/entities/product.entity.js';
import { CreateSkuDto } from './create-sku.dto.js';

export class SellerProductImageDto {
  @IsUrl({ require_protocol: true })
  url: string;

  @IsInt()
  @Min(0)
  sortOrder: number;

  @IsBoolean()
  isPrimary: boolean;
}

export class SellerProductSkuDto extends CreateSkuDto {}

export class CreateSellerProductDto {
  @IsUUID()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brand?: string | null;

  @IsOptional()
  @IsBoolean()
  isAuctionEligible?: boolean;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SellerProductImageDto)
  images: SellerProductImageDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SellerProductSkuDto)
  skus: SellerProductSkuDto[];
}

export class UpdateSellerProductDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brand?: string | null;

  @IsOptional()
  @IsBoolean()
  isAuctionEligible?: boolean;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SellerProductImageDto)
  images?: SellerProductImageDto[];
}

export class UpdateSellerProductStatusDto {
  @IsEnum(ProductStatus)
  status: ProductStatus;
}

export class SellerProductQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
