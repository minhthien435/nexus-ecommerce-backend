import type { EntityManager } from 'typeorm';

export interface CreateAuctionOrderInput {
  auctionId: string;
  auctionCode?: string | null;
  winnerId: string;
  sellerId: string;
  skuId: string;
  productId?: string;
  titleSnapshot: string;
  finalPrice: string;
  currency: string;
  paymentDeadlineAt: Date;
  warehouseId?: string | null;
}

export interface AuctionOrderResult {
  orderId: string;
  orderNumber: string;
}

export abstract class AuctionOrderHandoffApi {
  abstract createAuctionOrder(
    input: CreateAuctionOrderInput,
    manager?: EntityManager,
  ): Promise<AuctionOrderResult>;

  abstract cancelAuctionOrder(
    orderId: string,
    reason: string,
    manager?: EntityManager,
  ): Promise<void>;

  abstract findOrderByAuctionId(
    auctionId: string,
  ): Promise<{ orderId: string; orderNumber: string; status: string } | null>;
}
