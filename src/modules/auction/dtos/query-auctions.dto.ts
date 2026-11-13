import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const AUCTION_SORTS = [
  'ending_soon',
  'price_asc',
  'price_desc',
  'popular',
] as const;
export type AuctionSort = (typeof AUCTION_SORTS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalNumber = ({ value }: { value: unknown }) =>
  value === '' || value === undefined ? undefined : Number(value);

const optionalBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true || value === 1 || value === '1') {
    return true;
  }
  if (value === 'false' || value === false || value === 0 || value === '0') {
    return false;
  }
  return undefined;
};

export class QueryAuctionsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  status?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Transform(optionalNumber)
  minPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Transform(optionalNumber)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  sort?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(optionalBoolean)
  endingSoon?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) =>
    value === undefined || value === '' ? 1 : Number(value),
  )
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) =>
    value === undefined || value === '' ? 12 : Number(value),
  )
  limit = 12;
}
