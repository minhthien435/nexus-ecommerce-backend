import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { InventoryLedgerType } from '../domain/entities/inventory-ledger.entity.js';

export class SellerInventoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}

export class RestockSellerInventoryDto {
  @IsUUID()
  skuId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DecreaseSellerInventoryDto {
  @IsUUID()
  skuId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SellerInventoryHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @IsOptional()
  @IsEnum(InventoryLedgerType)
  type?: InventoryLedgerType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
