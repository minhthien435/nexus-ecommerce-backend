import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { OrderStatus } from '../domain/entities/order.entity.js';

export const SELLER_ORDER_STATUSES = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];

export type SellerOrderStatus = (typeof SELLER_ORDER_STATUSES)[number];

export class QuerySellerOrdersDto {
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
  limit?: number = 10;

  @IsOptional()
  @IsIn(SELLER_ORDER_STATUSES)
  status?: SellerOrderStatus;
}
