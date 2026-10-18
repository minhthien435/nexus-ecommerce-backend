import { Injectable } from '@nestjs/common';
import { CartMergeApi } from '../../commerce/cart-merge.api.js';
import type {
  CartMergeResult,
  GuestCartItem,
} from '../../commerce/cart-merge.api.js';
import { RbacService } from '../../identity/rbac/rbac.service.js';

export type LoginCartMergeResult =
  | CartMergeResult
  | {
      status: 'forbidden' | 'failed';
      accepted: [];
      skipped: [];
    };

@Injectable()
export class LoginCartMergeService {
  constructor(
    private readonly rbac: RbacService,
    private readonly cart: CartMergeApi,
  ) {}

  async merge(
    userId: string,
    input: readonly GuestCartItem[],
  ): Promise<LoginCartMergeResult> {
    if (input.length === 0)
      return { status: 'skipped', accepted: [], skipped: [] };
    try {
      if (!(await this.rbac.hasAllPermissions(userId, ['CART.CREATE']))) {
        return { status: 'forbidden', accepted: [], skipped: [] };
      }
      return await this.cart.mergeItems(userId, input);
    } catch {
      // Authentication has committed. Never expose dependency errors or claim
      // acceptance when the separate merge transaction did not confirm it.
      return { status: 'failed', accepted: [], skipped: [] };
    }
  }
}
