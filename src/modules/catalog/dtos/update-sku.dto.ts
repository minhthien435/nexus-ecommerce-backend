import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsSkuAttributes } from './sku-attributes.validator.js';

function isEmptyUpdate(dto: UpdateSkuDto): boolean {
  return [
    dto.attributes,
    dto.price,
    dto.currency,
    dto.weightGrams,
    dto.lengthCm,
    dto.widthCm,
    dto.heightCm,
    dto.isActive,
  ].every((value) => value === undefined);
}

export class UpdateSkuDto {
  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsSkuAttributes()
  attributes?: Record<string, string>;

  @ValidateIf((dto: UpdateSkuDto) =>
    dto.price !== undefined ? true : isEmptyUpdate(dto),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'Đơn vị tiền tệ phải gồm đúng 3 chữ cái',
  })
  currency?: string;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsInt()
  @IsPositive()
  weightGrams?: number;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  lengthCm?: number;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  widthCm?: number;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  heightCm?: number;

  @ValidateIf((_dto: UpdateSkuDto, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
