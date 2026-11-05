import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PERMISSIONS_KEY } from '../rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RolesGuard } from '../rbac/guards/roles.guard.js';
import { AdminShopController } from './admin-shop.controller.js';

describe('AdminShopController', () => {
  it('delegates list, detail and status updates', async () => {
    const shops = { list: vi.fn(), getById: vi.fn(), updateStatus: vi.fn() };
    const controller = new AdminShopController(shops as never);
    await controller.list({ page: 1, limit: 20 });
    await controller.get('22222222-2222-4222-8222-222222222222');
    await controller.updateStatus(
      'actor',
      '22222222-2222-4222-8222-222222222222',
      { status: 'CLOSED', reason: 'done' },
    );
    expect(shops.updateStatus).toHaveBeenCalledWith(
      'actor',
      expect.any(String),
      'CLOSED',
      'done',
    );
  });

  it('requires ADMIN role and access, role and permission guards with route privileges', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminShopController)).toEqual([
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminShopController)).toEqual([
      AccessTokenGuard,
      RolesGuard,
      PermissionsGuard,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminShopController.prototype.list),
    ).toEqual(['SHOP.LIST']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminShopController.prototype.get),
    ).toEqual(['SHOP.VIEW']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminShopController.prototype.updateStatus,
      ),
    ).toEqual(['SHOP.UPDATE']);
  });
});
