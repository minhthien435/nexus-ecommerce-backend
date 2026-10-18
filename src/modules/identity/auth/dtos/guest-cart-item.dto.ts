import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class GuestCartItemDto {
  @IsUUID()
  skuId: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity: number;
}

export class GuestCartInputDto {
  // IsOptional also accepts null; only absence preserves the legacy contract.
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => GuestCartItemDto)
  guestCartItems?: GuestCartItemDto[];
}
