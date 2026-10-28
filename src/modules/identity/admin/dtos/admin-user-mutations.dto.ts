import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '../../auth/password-policy.js';

export class AdminUserStatusDto {
  @IsIn(['ACTIVE', 'LOCKED'])
  status: 'ACTIVE' | 'LOCKED';

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminUserRolesDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((code: unknown) =>
          typeof code === 'string' ? code.trim().toUpperCase() : code,
        )
      : value,
  )
  assign?: string[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((code: unknown) =>
          typeof code === 'string' ? code.trim().toUpperCase() : code,
        )
      : value,
  )
  revoke?: string[];
}

export class AdminUserPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}
