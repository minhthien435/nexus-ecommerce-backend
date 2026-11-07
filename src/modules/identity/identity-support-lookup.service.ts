import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ShopEntity } from './domain/shop.entity.js';
import { UserEntity } from './domain/user.entity.js';
import {
  IdentitySupportLookupApi,
  type SupportIdentityShop,
  type SupportIdentityUser,
} from './identity-support-lookup.api.js';

@Injectable()
export class IdentitySupportLookupService extends IdentitySupportLookupApi {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(ShopEntity)
    private readonly shops: Repository<ShopEntity>,
  ) {
    super();
  }

  async findBuyerIdsByEmail(email: string): Promise<string[]> {
    const users = await this.users.find({
      select: { id: true },
      where: { email: email.trim().toLowerCase(), deletedAt: IsNull() },
    });
    return users.map((user) => user.id);
  }

  async getUsersByIds(userIds: string[]): Promise<SupportIdentityUser[]> {
    const ids = this.uniqueIds(userIds);
    if (ids.length === 0) return [];
    return this.users.find({
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        status: true,
      },
      where: { id: In(ids), deletedAt: IsNull() },
    });
  }

  async getShopsBySellerIds(
    sellerIds: string[],
  ): Promise<SupportIdentityShop[]> {
    const ids = this.uniqueIds(sellerIds);
    if (ids.length === 0) return [];
    return this.shops.find({
      select: {
        sellerId: true,
        name: true,
        status: true,
        logoUrl: true,
      },
      where: { sellerId: In(ids), deletedAt: IsNull() },
    });
  }

  private uniqueIds(ids: string[]): string[] {
    return [...new Set(ids.map((id) => id.toLowerCase()))];
  }
}
