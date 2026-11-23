import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { AdminFlashDealController } from './admin-flash-deal.controller.js';

describe('AdminFlashDealController', () => {
  const adminService = {
    listCampaigns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getCampaignDetail: vi.fn().mockResolvedValue({ id: 'camp-1', items: [] }),
    createCampaign: vi.fn().mockResolvedValue({ id: 'camp-1' }),
    updateCampaign: vi.fn().mockResolvedValue({ id: 'camp-1' }),
    addItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
    updateItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
    removeItem: vi.fn().mockResolvedValue({ id: 'item-1', mode: 'DELETED' }),
    cancelCampaign: vi
      .fn()
      .mockResolvedValue({ id: 'camp-1', status: 'CANCELLED' }),
    inviteSellers: vi
      .fn()
      .mockResolvedValue({ invited: 3, invitedAt: '2026-11-23T02:00:00.000Z' }),
    listRegistrations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    approveRegistration: vi
      .fn()
      .mockResolvedValue({ id: 'reg-1', status: 'APPROVED' }),
    rejectRegistration: vi
      .fn()
      .mockResolvedValue({ id: 'reg-1', status: 'REJECTED' }),
  };

  it('enforces ADMIN role and FLASH_DEAL RBAC permissions on all endpoints', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminFlashDealController)).toEqual([
      'ADMIN',
    ]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.list,
      ),
    ).toEqual(['FLASH_DEAL.LIST']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.detail,
      ),
    ).toEqual(['FLASH_DEAL.LIST']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.create,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.update,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.addItem,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.updateItem,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.removeItem,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.cancel,
      ),
    ).toEqual(['FLASH_DEAL.CANCEL']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.inviteSellers,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.listRegistrations,
      ),
    ).toEqual(['FLASH_DEAL.LIST']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.approveRegistration,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminFlashDealController.prototype.rejectRegistration,
      ),
    ).toEqual(['FLASH_DEAL.MANAGE']);
  });

  it('rejects empty PATCH payloads before invoking service', () => {
    const controller = new AdminFlashDealController(adminService as never);

    expect(() => controller.update('camp-1', {})).toThrow(BadRequestException);
    expect(() => controller.updateItem('camp-1', 'item-1', {})).toThrow(
      BadRequestException,
    );
  });

  it('delegates CRUD and cancel operations to FlashDealAdminService', async () => {
    const controller = new AdminFlashDealController(adminService as never);

    await controller.list({ page: 1, limit: 20 });
    expect(adminService.listCampaigns).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
    });

    await controller.create('admin-1', {
      title: 'Flash 12H',
      startsAt: '2026-11-21T05:00:00.000Z',
      endsAt: '2026-11-21T06:00:00.000Z',
    });
    expect(adminService.createCampaign).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ title: 'Flash 12H' }),
    );

    await controller.cancel('camp-1');
    expect(adminService.cancelCampaign).toHaveBeenCalledWith('camp-1');
  });
});
