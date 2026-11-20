import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

export class FlashDealPageQueryDto {
  @IsOptional() @IsInt() @Min(1) @Transform(toNumber) page = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) @Transform(toNumber) limit = 20;
}

export class ActiveFlashDealQueryDto extends FlashDealPageQueryDto {
  @IsOptional() @IsUUID() campaignId?: string;
}

export class TrustedShopQueryDto extends FlashDealPageQueryDto {}
