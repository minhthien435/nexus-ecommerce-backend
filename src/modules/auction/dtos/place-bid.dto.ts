import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MIN_AUCTION_BID_AMOUNT } from '../auction-lifecycle.constants.js';

export class PlaceBidDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_BID_AMOUNT, { message: 'Giá đặt tối thiểu là 1.000₫' })
  amount: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey?: string;
}
