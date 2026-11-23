import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';
import {
  MIN_AUCTION_BID_INCREMENT,
  MIN_AUCTION_PRICE,
} from '../auction-lifecycle.constants.js';

export class CreateAuctionDto {
  @IsUUID() skuId: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_PRICE, { message: 'Giá khởi điểm tối thiểu là 50.000₫' })
  startPrice: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_PRICE, { message: 'Giá sàn tối thiểu là 50.000₫' })
  reservePrice: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AUCTION_BID_INCREMENT, { message: 'Bước giá tối thiểu là 10.000₫' })
  bidIncrement: number;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
}
