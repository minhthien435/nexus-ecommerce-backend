import { Type } from 'class-transformer';
import { IsDateString, IsNumber, Min, ValidateIf } from 'class-validator';

export class UpdateAuctionDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  startPrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  reservePrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  bidIncrement?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  startsAt?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  endsAt?: string;
}
