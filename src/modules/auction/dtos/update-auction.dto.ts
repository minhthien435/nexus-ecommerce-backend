import { Type } from 'class-transformer';
import { IsDateString, IsNumber, Min, ValidateIf } from 'class-validator';
import {
  MIN_AUCTION_BID_INCREMENT,
  MIN_AUCTION_PRICE,
} from '../auction-lifecycle.constants.js';

export class UpdateAuctionDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_PRICE, { message: 'Giá khởi điểm tối thiểu là 50.000₫' })
  startPrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_PRICE, { message: 'Giá sàn tối thiểu là 50.000₫' })
  reservePrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_BID_INCREMENT, { message: 'Bước giá tối thiểu là 10.000₫' })
  bidIncrement?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  startsAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  endsAt?: string;
}
