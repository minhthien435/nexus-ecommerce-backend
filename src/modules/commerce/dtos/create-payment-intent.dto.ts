import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsUUID('4', { message: 'orderId must be a valid UUID' })
  orderId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;
}
