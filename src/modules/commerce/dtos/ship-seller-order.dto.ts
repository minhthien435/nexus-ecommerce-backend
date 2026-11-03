import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ShipSellerOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
