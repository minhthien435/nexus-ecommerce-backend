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
  ValidateIf,
} from 'class-validator';
import { MIN_FLASH_PRICE } from '../catalog-pricing.constants.js';
import { FlashDealCampaignStatus } from '../domain/entities/flash-deal-campaign.entity.js';
import { FlashDealItemStatus } from '../domain/entities/flash-deal-item.entity.js';
import {
  FLASH_DEAL_REGISTRATION_FILTER_STATUSES,
  type FlashDealRegistrationFilterStatus,
} from './seller-flash-deal.dto.js';

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

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  registrationOpensAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  registrationClosesAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(toNumber)
  @IsInt()
  @Min(5)
  @Max(90)
  minDiscountPercent?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(100)
  minReputation?: number | null;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  maxItemsPerSeller?: number;
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

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  registrationOpensAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  registrationClosesAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(toNumber)
  @IsInt()
  @Min(5)
  @Max(90)
  minDiscountPercent?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(100)
  minReputation?: number | null;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  maxItemsPerSeller?: number;
}

export class QueryAdminFlashDealRegistrationsDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(FLASH_DEAL_REGISTRATION_FILTER_STATUSES)
  status?: FlashDealRegistrationFilterStatus;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class RejectFlashDealRegistrationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class AddFlashDealItemDto {
  @IsUUID()
  skuId: string;

  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_FLASH_PRICE, { message: 'Giá Flash Deal tối thiểu là 1.000₫' })
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
  @Min(MIN_FLASH_PRICE, { message: 'Giá Flash Deal tối thiểu là 1.000₫' })
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
