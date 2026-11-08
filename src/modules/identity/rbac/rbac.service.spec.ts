import { describe, expect, it, vi } from 'vitest';
import { RbacService } from './rbac.service.js';
import {
  PRIVILEGE_SEEDS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_CODES,
} from './rbac.constants.js';

describe('RbacService — Unified Single STAFF Role Architecture', () => {
  const staffUserId = '11111111-1111-4111-8111-111111111111';
  const adminUserId = '33333333-3333-4333-8333-333333333333';
  const buyerUserId = '44444444-4444-4444-8444-444444444444';
  const sellerUserId = '55555555-5555-4555-8555-555555555555';

  function createService(
    userRolesMap: Record<string, string[]>,
    permissionsMap: Record<string, string[]> = {},
  ) {
    const qb = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn(),
    };

    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    };

    qb.getRawMany.mockImplementation(async () => {
      const lastWhereCall = qb.where.mock.calls.at(-1);
      const params = lastWhereCall ? lastWhereCall[1] : undefined;
      const targetUserId = params?.userId;
      const roles = userRolesMap[targetUserId] ?? [];
      const perms = permissionsMap[targetUserId] ?? [];

      const lastSelectCall = qb.select.mock.calls.at(-1);
      if (
        lastSelectCall &&
        String(lastSelectCall[0]).includes('privilege.code')
      ) {
        return perms.map((code) => ({ code }));
      }

      return roles.map((code) => ({ code }));
    });

    return { service: new RbacService(repo as never), repo, qb };
  }

  describe('getRoles & Role-based Access Control', () => {
    it('1. truy vấn role trực tiếp từ database mà không qua alias hay kế thừa', async () => {
      const { service } = createService({ [staffUserId]: ['STAFF'] });

      const roles = await service.getRoles(staffUserId);
      expect(roles).toEqual(['STAFF']);

      const canAccessStaffEndpoints = await service.hasAnyRole(staffUserId, [
        'ADMIN',
        'STAFF',
      ]);
      expect(canAccessStaffEndpoints).toBe(true);

      const isOnlyAdmin = await service.hasAnyRole(staffUserId, ['ADMIN']);
      expect(isOnlyAdmin).toBe(false);
    });

    it('2. cho phép ADMIN có toàn quyền truy cập', async () => {
      const { service } = createService({ [adminUserId]: ['ADMIN'] });

      const roles = await service.getRoles(adminUserId);
      expect(roles).toEqual(['ADMIN']);

      const canAccessStaffEndpoints = await service.hasAnyRole(adminUserId, [
        'ADMIN',
        'STAFF',
      ]);
      expect(canAccessStaffEndpoints).toBe(true);
    });

    it('3. chặn BUYER truy cập các endpoint của STAFF', async () => {
      const { service } = createService({ [buyerUserId]: ['BUYER'] });

      const roles = await service.getRoles(buyerUserId);
      expect(roles).toEqual(['BUYER']);

      const canAccessStaffEndpoints = await service.hasAnyRole(buyerUserId, [
        'ADMIN',
        'STAFF',
      ]);
      expect(canAccessStaffEndpoints).toBe(false);
    });

    it('4. chặn SELLER truy cập các endpoint của STAFF', async () => {
      const { service } = createService({ [sellerUserId]: ['SELLER'] });

      const roles = await service.getRoles(sellerUserId);
      expect(roles).toEqual(['SELLER']);

      const canAccessStaffEndpoints = await service.hasAnyRole(sellerUserId, [
        'ADMIN',
        'STAFF',
      ]);
      expect(canAccessStaffEndpoints).toBe(false);
    });
  });

  describe('getPermissions & Permission-based Access Control', () => {
    it('5. truy vấn permissions trực tiếp từ database theo role của user', async () => {
      const staffPerms = [
        'DISPUTE.MANAGE',
        'ORDER.CANCEL',
        'ORDER.LIST',
        'ORDER.REFUND',
        'ORDER.VIEW',
      ];
      const { service } = createService(
        { [staffUserId]: ['STAFF'] },
        { [staffUserId]: staffPerms },
      );

      const permissions = await service.getPermissions(staffUserId);
      expect(permissions).toEqual(staffPerms);

      const canManageDisputes = await service.hasAllPermissions(staffUserId, [
        'DISPUTE.MANAGE',
      ]);
      expect(canManageDisputes).toBe(true);
    });

    it('6. chặn STAFF không được truy cập chức năng xử lý Dispute nếu không có quyền DISPUTE.MANAGE', async () => {
      const staffWithoutDisputePerm = ['ORDER.VIEW', 'ORDER.LIST'];
      const { service } = createService(
        { [staffUserId]: ['STAFF'] },
        { [staffUserId]: staffWithoutDisputePerm },
      );

      const permissions = await service.getPermissions(staffUserId);
      expect(permissions).not.toContain('DISPUTE.MANAGE');

      const canManageDisputes = await service.hasAllPermissions(staffUserId, [
        'DISPUTE.MANAGE',
      ]);
      expect(canManageDisputes).toBe(false);
    });

    it('7. trả về true khi danh sách required roles hoặc permissions rỗng', async () => {
      const { service } = createService({ [staffUserId]: ['STAFF'] });

      expect(await service.hasAnyRole(staffUserId, [])).toBe(true);
      expect(await service.hasAllPermissions(staffUserId, [])).toBe(true);
    });
  });

  describe('RBAC Constants & Seed Validation', () => {
    it('8. xác nhận SYSTEM_ROLE_CODES và SYSTEM_ROLES chỉ gồm đúng 4 role chuẩn', () => {
      expect(SYSTEM_ROLE_CODES).toEqual(['BUYER', 'SELLER', 'STAFF', 'ADMIN']);

      const roleCodes = SYSTEM_ROLES.map((r) => r.code);
      expect(roleCodes).toEqual(['BUYER', 'SELLER', 'STAFF', 'ADMIN']);

      const uniqueCodes = new Set(roleCodes);
      expect(uniqueCodes.size).toBe(4);
    });

    it('9. xác nhận quyền DISPUTE.MANAGE được cấp trực tiếp cho ADMIN và STAFF', () => {
      const disputePrivilege = PRIVILEGE_SEEDS.find(
        (p) => p.code === 'DISPUTE.MANAGE',
      );
      expect(disputePrivilege).toBeDefined();
      expect(disputePrivilege?.module).toBe('COMMERCE');
      expect(disputePrivilege?.roles).toContain('ADMIN');
      expect(disputePrivilege?.roles).toContain('STAFF');
      expect(disputePrivilege?.roles).not.toContain('BUYER');
      expect(disputePrivilege?.roles).not.toContain('SELLER');
      expect(disputePrivilege?.roles).toHaveLength(2);
    });

    it('10. xác nhận các quyền đơn hàng và hoàn tiền (ORDER.*, REFUND.*) cấp đầy đủ cho STAFF', () => {
      const refundPrivilege = PRIVILEGE_SEEDS.find(
        (p) => p.code === 'ORDER.REFUND',
      );
      expect(refundPrivilege?.roles).toContain('STAFF');
      expect(refundPrivilege?.roles).toContain('ADMIN');

      const cancelPrivilege = PRIVILEGE_SEEDS.find(
        (p) => p.code === 'ORDER.CANCEL',
      );
      expect(cancelPrivilege?.roles).toContain('STAFF');
      expect(cancelPrivilege?.roles).toContain('ADMIN');

      const viewPrivilege = PRIVILEGE_SEEDS.find(
        (p) => p.code === 'ORDER.VIEW',
      );
      expect(viewPrivilege?.roles).toContain('STAFF');

      const listPrivilege = PRIVILEGE_SEEDS.find(
        (p) => p.code === 'ORDER.LIST',
      );
      expect(listPrivilege?.roles).toContain('STAFF');
    });
  });
});
