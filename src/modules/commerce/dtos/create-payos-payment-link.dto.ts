import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePayosPaymentLinkDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  useCoins?: number;

  @IsUUID('4', { message: 'orderId must be a valid UUID v4' })
  orderId: string;

  @IsOptional()
  @IsString({ message: 'idempotencyKey must be a string' })
  @MaxLength(100, {
    message: 'idempotencyKey must not exceed 100 characters',
  })
  idempotencyKey?: string;
}

export interface CreatePayosPaymentLinkResult {
  paymentId: string;
  orderId: string;
  orderCode: number;
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string;
  amount: number;
  payableAmount?: number;
  coinDiscountAmount?: number;
  currency: string;
  status: string;
}
