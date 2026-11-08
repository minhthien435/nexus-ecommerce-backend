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
import {
  DISPUTE_REASON_CATEGORIES,
  ORDER_DISPUTE_STATUSES,
  type DisputeReasonCategory,
  type OrderDisputeStatus,
} from '../domain/entities/order-dispute.entity.js';

@ValidatorConstraint({ name: 'disputeDateRange', async: false })
class DisputeDateRangeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as QuerySupportDisputesDto;
    if (!object.fromDate || !object.toDate) return true;
    return (
      new Date(object.fromDate).getTime() <= new Date(object.toDate).getTime()
    );
  }

  defaultMessage(): string {
    return 'toDate phải lớn hơn hoặc bằng fromDate';
  }
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class QuerySupportDisputesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Transform(trim)
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(ORDER_DISPUTE_STATUSES, {
    message: `Trạng thái khiếu nại phải là một trong các giá trị: ${ORDER_DISPUTE_STATUSES.join(', ')}`,
  })
  status?: OrderDisputeStatus;

  @IsOptional()
  @IsIn(DISPUTE_REASON_CATEGORIES, {
    message: `Lý do khiếu nại phải là một trong các giá trị: ${DISPUTE_REASON_CATEGORIES.join(', ')}`,
  })
  reasonCategory?: DisputeReasonCategory;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'buyerEmail phải là một địa chỉ email hợp lệ' })
  @MaxLength(255)
  buyerEmail?: string;

  @IsOptional()
  @IsUUID('all', { message: 'sellerId phải là một UUID hợp lệ' })
  sellerId?: string;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'fromDate phải theo định dạng ngày ISO 8601' },
  )
  fromDate?: string;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'toDate phải theo định dạng ngày ISO 8601' },
  )
  @Validate(DisputeDateRangeConstraint)
  toDate?: string;
}
