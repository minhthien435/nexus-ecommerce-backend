import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateAuctionDto {
  @IsUUID() skuId: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  startPrice: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  reservePrice: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  bidIncrement: number;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
}
