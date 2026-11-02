import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const optionalText = (_object: unknown, value: unknown) =>
  value !== undefined && value !== null;
const definedValue = (_object: unknown, value: unknown) => value !== undefined;

export class RegisterSellerShopDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  headline?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  bannerUrl?: string;

  @Transform(trim)
  @IsString()
  @Matches(/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/)
  phone: string;

  @Transform(trim)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  warehouseAddress: string;

  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  identityNumber: string;
}

export class UpdateSellerShopDto {
  @Transform(trim)
  @ValidateIf(optionalText)
  @IsString()
  @MaxLength(255)
  headline?: string | null;

  @Transform(trim)
  @ValidateIf(optionalText)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @Transform(trim)
  @ValidateIf(optionalText)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string | null;

  @Transform(trim)
  @ValidateIf(optionalText)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  bannerUrl?: string | null;

  @Transform(trim)
  @ValidateIf(definedValue)
  @IsString()
  @Matches(/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/)
  phone?: string;

  @Transform(trim)
  @ValidateIf(optionalText)
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @Transform(trim)
  @ValidateIf(definedValue)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  warehouseAddress?: string;
}
