import { Transform } from 'class-transformer';
import {
  PREFERRED_LANGUAGES,
  type PreferredLanguage,
} from '../../domain/preferred-language.js';
import {
  IsIn,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(PREFERRED_LANGUAGES)
  preferredLanguage?: PreferredLanguage;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  fullName?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/^\d{10}$/)
  phone?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  avatarUrl?: string | null;
}
