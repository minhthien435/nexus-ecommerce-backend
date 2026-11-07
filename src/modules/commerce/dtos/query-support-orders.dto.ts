import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import type { OrderStatus } from '../domain/entities/order.entity.js';

export const SUPPORT_ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUND_REQUESTED',
  'REFUNDED',
] as const satisfies readonly OrderStatus[];

@ValidatorConstraint({ name: 'dateRange', async: false })
class DateRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as QuerySupportOrdersDto;
    if (!object.fromDate || !object.toDate) return true;
    return (
      new Date(object.fromDate).getTime() <= new Date(object.toDate).getTime()
    );
  }

  defaultMessage(): string {
    return 'toDate must be greater than or equal to fromDate';
  }
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class QuerySupportOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Transform(trim)
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  buyerEmail?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsIn(SUPPORT_ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Validate(DateRangeConstraint)
  toDate?: string;
}
