import type { UserStatus } from './domain/user-status.js';
import type { ShopStatus } from './domain/shop.entity.js';

export type SupportIdentityUser = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: UserStatus;
};

export type SupportIdentityShop = {
  sellerId: string;
  name: string;
  status: ShopStatus;
  logoUrl: string | null;
};

export abstract class IdentitySupportLookupApi {
  abstract findBuyerIdsByEmail(email: string): Promise<string[]>;
  abstract getUsersByIds(userIds: string[]): Promise<SupportIdentityUser[]>;
  abstract getShopsBySellerIds(
    sellerIds: string[],
  ): Promise<SupportIdentityShop[]>;
}
