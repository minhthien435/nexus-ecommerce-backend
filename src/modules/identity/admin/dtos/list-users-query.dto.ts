import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { USER_STATUSES, type UserStatus } from '../../domain/user-status.js';

const SORT_FIELDS = ['fullName', 'email', 'createdAt', 'status'] as const;
const SORT_ORDERS = ['ASC', 'DESC'] as const;

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  role?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => Number(value))
  limit = 20;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'fullName';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  sortOrder: (typeof SORT_ORDERS)[number] = 'ASC';
}
