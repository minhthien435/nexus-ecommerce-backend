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
import { MIN_FLASH_PRICE } from '../catalog-pricing.constants.js';
import { FlashDealRegistrationStatus } from '../domain/entities/flash-deal-registration.entity.js';

const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' || value === null
    ? undefined
    : Number(value);

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SELLER_FLASH_DEAL_STATES = ['OPEN', 'UPCOMING', 'CLOSED'] as const;
export type SellerFlashDealStateFilter =
  (typeof SELLER_FLASH_DEAL_STATES)[number];

export const FLASH_DEAL_REGISTRATION_FILTER_STATUSES = [
  'ALL',
  FlashDealRegistrationStatus.PENDING,
  FlashDealRegistrationStatus.APPROVED,
  FlashDealRegistrationStatus.REJECTED,
  FlashDealRegistrationStatus.WITHDRAWN,
  FlashDealRegistrationStatus.EXPIRED,
] as const;
export type FlashDealRegistrationFilterStatus =
  (typeof FLASH_DEAL_REGISTRATION_FILTER_STATUSES)[number];

export class QuerySellerFlashDealCampaignsDto {
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SELLER_FLASH_DEAL_STATES)
  state?: SellerFlashDealStateFilter;
}

export class QuerySellerFlashDealRegistrationsDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;

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

export class QueryEligibleFlashDealSkusDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(160)
  q?: string;

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

export class CreateFlashDealRegistrationDto {
  @IsUUID()
  skuId: string;

  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_FLASH_PRICE, { message: 'Giá Flash Deal tối thiểu là 1.000₫' })
  flashPrice: number;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quotaQty: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPerBuyer = 2;
}

export class UpdateFlashDealRegistrationDto {
  @IsOptional()
  @Transform(toNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_FLASH_PRICE, { message: 'Giá Flash Deal tối thiểu là 1.000₫' })
  flashPrice?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quotaQty?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPerBuyer?: number;
}
