import type { EntityManager } from 'typeorm';

export type CartSku = {
  id: string;
  productId: string;
  sellerId: string;
  skuCode: string;
  variantAttributes: Record<string, unknown> | null;
  price: string;
  currency: string;
  isActive: boolean;
  productName: string;
  productSlug: string;
  productStatus: string;
  productDeletedAt: Date | null;
};

export abstract class CatalogCartApi {
  abstract getCartSkus(
    skuIds: string[],
    manager?: EntityManager,
  ): Promise<CartSku[]>;
}
