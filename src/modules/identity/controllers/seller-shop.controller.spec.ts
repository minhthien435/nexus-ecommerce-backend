import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { ROLES_KEY } from '../rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { SellerShopController } from './seller-shop.controller.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('SellerShopController', () => {
  it('delegates registration and shop mutations with the authenticated user', async () => {
    const shops = {
      registerShop: vi.fn().mockResolvedValue({ id: 'shop' }),
      getMyShop: vi.fn().mockResolvedValue({ id: 'shop' }),
      updateMyShop: vi.fn().mockResolvedValue({ id: 'shop' }),
      closeMyShop: vi.fn().mockResolvedValue({ id: 'shop', status: 'CLOSED' }),
      getReputationHistory: vi.fn().mockResolvedValue({
        currentReputationScore: 75,
        auctionEligibilityThreshold: 70,
        isAuctionEligible: true,
        history: [],
        meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
      }),
    };
    const controller = new SellerShopController(shops as never);
    const registration = {
      name: 'Nexus Shop',
      phone: '0912345678',
      warehouseAddress: 'Ho Chi Minh City',
      identityNumber: '012345678901',
    };

    await controller.register(userId, registration);
    await controller.getMine(userId);
    await controller.updateMine(userId, { headline: 'Hello' });
    await controller.closeMine(userId);
    await controller.getReputationHistory(userId, { page: 1, limit: 10 });

    expect(shops.registerShop).toHaveBeenCalledWith(userId, registration);
    expect(shops.getMyShop).toHaveBeenCalledWith(userId);
    expect(shops.updateMyShop).toHaveBeenCalledWith(userId, {
      headline: 'Hello',
    });
    expect(shops.closeMyShop).toHaveBeenCalledWith(userId);
    expect(shops.getReputationHistory).toHaveBeenCalledWith(userId, {
      page: 1,
      limit: 10,
    });
  });

  it('requires authentication for registration and live SELLER RBAC for read/update', () => {
    const registerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SellerShopController.prototype.register,
    );
    const readGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SellerShopController.prototype.getMine,
    );
    const updateGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SellerShopController.prototype.updateMine,
    );
    const closeGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SellerShopController.prototype.closeMine,
    );
    const historyGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      SellerShopController.prototype.getReputationHistory,
    );

    expect(registerGuards).toEqual([AccessTokenGuard]);
    expect(readGuards).toEqual([AccessTokenGuard, RolesGuard]);
    expect(updateGuards).toEqual([AccessTokenGuard, RolesGuard]);
    expect(closeGuards).toEqual([AccessTokenGuard, RolesGuard]);
    expect(historyGuards).toEqual([AccessTokenGuard, RolesGuard]);
    expect(
      Reflect.getMetadata(ROLES_KEY, SellerShopController.prototype.getMine),
    ).toEqual(['SELLER']);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerShopController.prototype.getReputationHistory,
      ),
    ).toEqual(['SELLER']);
    expect(
      Reflect.getMetadata(ROLES_KEY, SellerShopController.prototype.updateMine),
    ).toEqual(['SELLER']);
    expect(
      Reflect.getMetadata(ROLES_KEY, SellerShopController.prototype.closeMine),
    ).toEqual(['SELLER']);
  });
});
