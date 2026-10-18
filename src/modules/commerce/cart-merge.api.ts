import type { CartService } from './services/cart.service.js';

export type GuestCartItem = { skuId: string; quantity: number };
export type CartMergeSkipReason =
  | 'SKU_NOT_FOUND'
  | 'SKU_UNAVAILABLE'
  | 'CART_QUANTITY_OVERFLOW'
  | 'INSUFFICIENT_STOCK';
export type CartMergeResult = {
  status: 'merged' | 'partial' | 'skipped';
  accepted: Array<{ skuId: string; quantityAdded: number; quantity: number }>;
  skipped: Array<{ skuId: string; reason: CartMergeSkipReason }>;
  cart?: Awaited<ReturnType<CartService['projectCart']>>;
};

export abstract class CartMergeApi {
  abstract mergeItems(
    userId: string,
    input: readonly GuestCartItem[],
  ): Promise<CartMergeResult>;
}
