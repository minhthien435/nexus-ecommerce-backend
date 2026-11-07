import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min, MaxLength } from 'class-validator';

export class CalculateShippingFeeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  toDistrictId: number;

  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(20)
  toWardCode: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000000)
  weightInGrams: number;
}

export class DistrictsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  provinceId: number;
}

export class WardsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  districtId: number;
}
