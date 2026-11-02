import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePayosPaymentLinkDto {
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
  currency: string;
  status: string;
}
