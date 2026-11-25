import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductReviewDto {
  @IsUUID()
  orderItemId: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  comment?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @MaxLength(2048, { each: true })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true },
  )
  imageUrls?: string[];
}

export class ReplyProductReviewDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reply: string;
}

export class ProductReviewQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
