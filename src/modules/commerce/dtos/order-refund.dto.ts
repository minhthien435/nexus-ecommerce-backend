import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  ORDER_REFUND_STATUSES,
  type OrderRefundStatus,
} from '../domain/entities/order-refund.entity.js';

export class QueryOrderRefundsDto {
  @IsOptional()
  @IsIn(ORDER_REFUND_STATUSES)
  status?: OrderRefundStatus;

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
}

export class ConfirmRefundTransferredDto {
  @IsString()
  @Length(1, 100)
  bankReferenceCode: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

export class RejectOrderRefundDto {
  @IsString()
  @Length(1, 500)
  reason: string;
}
