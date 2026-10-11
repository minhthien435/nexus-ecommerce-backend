import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  roleCode: string;
}
