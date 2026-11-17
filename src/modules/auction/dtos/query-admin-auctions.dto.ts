import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const ADMIN_AUCTION_SORTS = [
  'ending_soon',
  'newest',
  'price_asc',
  'price_desc',
  'popular',
  'extensions_desc',
] as const;
export type AdminAuctionSort = (typeof ADMIN_AUCTION_SORTS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class QueryAdminAuctionsDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  status?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  search?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  sort?: string;

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
