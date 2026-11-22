import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';

const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' || value === null
    ? undefined
    : Number(value);

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ADMIN_FLASH_DEAL_FILTER_STATUSES = [
  'ALL',
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'CANCELLED',
] as const;

export type AdminFlashDealFilterStatus =
  (typeof ADMIN_FLASH_DEAL_FILTER_STATUSES)[number];

export class QueryAdminFlashDealsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(toNumber)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(toNumber)
  limit = 20;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(ADMIN_FLASH_DEAL_FILTER_STATUSES)
  status?: AdminFlashDealFilterStatus;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class CreateFlashDealCampaignDto {
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional()
  @IsIn([FlashDealCampaignStatus.DRAFT, FlashDealCampaignStatus.SCHEDULED])
  status?: FlashDealCampaignStatus.DRAFT | FlashDealCampaignStatus.SCHEDULED;
}

export class UpdateFlashDealCampaignDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsIn([FlashDealCampaignStatus.DRAFT, FlashDealCampaignStatus.SCHEDULED])
  status?: FlashDealCampaignStatus.DRAFT | FlashDealCampaignStatus.SCHEDULED;
}

export class AddFlashDealItemDto {
  @IsUUID()
  skuId: string;

  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  flashPrice: number;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  quotaQty: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  maxPerBuyer = 2;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  sortOrder = 0;

  @IsOptional()
  @IsIn([FlashDealItemStatus.ACTIVE, FlashDealItemStatus.PAUSED])
  status?: FlashDealItemStatus.ACTIVE | FlashDealItemStatus.PAUSED;
}

export class UpdateFlashDealItemDto {
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  quotaQty?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  flashPrice?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  maxPerBuyer?: number;

  @IsOptional()
  @IsIn([
    FlashDealItemStatus.ACTIVE,
    FlashDealItemStatus.PAUSED,
    FlashDealItemStatus.CANCELLED,
  ])
  status?: FlashDealItemStatus;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
