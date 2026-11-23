import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { SellerFlashDealController } from './seller-flash-deal.controller.js';

describe('SellerFlashDealController', () => {
  const service = {
    listCampaigns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCampaignDetail: vi.fn().mockResolvedValue({ id: 'camp-1' }),
    listEligibleSkus: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    createRegistration: vi.fn().mockResolvedValue({ id: 'reg-1' }),
    listRegistrations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    updateRegistration: vi.fn().mockResolvedValue({ id: 'reg-1' }),
    withdrawRegistration: vi
      .fn()
      .mockResolvedValue({ id: 'reg-1', status: 'WITHDRAWN' }),
  };

  it('enforces SELLER role, FLASH_DEAL.REGISTER permission, and canonical route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SellerFlashDealController)).toBe(
      'api/v1/catalog/seller/flash-deals',
    );
    expect(Reflect.getMetadata(ROLES_KEY, SellerFlashDealController)).toEqual([
      'SELLER',
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SellerFlashDealController),
    ).toEqual(['FLASH_DEAL.REGISTER']);
  });

  it('rejects empty PATCH registration payloads before calling service', () => {
    const controller = new SellerFlashDealController(service as never);
    expect(() =>
      controller.updateRegistration('seller-1', 'reg-1', {}),
    ).toThrow(BadRequestException);
  });

  it('delegates seller endpoints to SellerFlashDealService', async () => {
    const controller = new SellerFlashDealController(service as never);
    await controller.listCampaigns('seller-1', { page: 1, limit: 10 });
    expect(service.listCampaigns).toHaveBeenCalledWith('seller-1', {
      page: 1,
      limit: 10,
    });

    await controller.withdrawRegistration('seller-1', 'reg-1');
    expect(service.withdrawRegistration).toHaveBeenCalledWith(
      'seller-1',
      'reg-1',
    );
  });
});
