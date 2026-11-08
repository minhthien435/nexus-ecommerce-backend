import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { PERMISSIONS_KEY } from '../../identity/rbac/decorators/permissions.decorator.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { SupportDisputeController } from './support-dispute.controller.js';
import type { OrderDisputeService } from '../services/order-dispute.service.js';
import type { QuerySupportDisputesDto } from '../dtos/query-support-disputes.dto.js';

describe('SupportDisputeController', () => {
  describe('Security Metadata', () => {
    it('bảo vệ controller bằng AccessTokenGuard, RolesGuard, PermissionsGuard với role ADMIN/STAFF/SUPPORT_STAFF và quyền DISPUTE.MANAGE', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        SupportDisputeController,
      );
      expect(guards).toEqual([AccessTokenGuard, RolesGuard, PermissionsGuard]);

      const roles = Reflect.getMetadata(ROLES_KEY, SupportDisputeController);
      expect(roles).toEqual(['ADMIN', 'STAFF', 'SUPPORT_STAFF']);

      const methodPermissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        SupportDisputeController.prototype.list,
      );
      expect(methodPermissions).toEqual(['DISPUTE.MANAGE']);

      const resolvePermissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        SupportDisputeController.prototype.resolve,
      );
      expect(resolvePermissions).toEqual(['DISPUTE.MANAGE']);
    });
  });

  describe('resolve', () => {
    it('gọi service.resolveDispute và trả về response chuẩn', async () => {
      const disputeId = 'dispute-uuid-1111';
      const actorId = 'actor-uuid-2222';
      const dto = {
        decision: 'ACCEPTED_REFUND' as const,
        staffDecisionNote: 'Chấp thuận hoàn tiền',
      };

      const mockResult = {
        id: disputeId,
        orderId: 'order-uuid-3333',
        orderNumber: 'ORD-001',
        status: 'ACCEPTED_REFUND' as const,
        staffDecisionNote: 'Chấp thuận hoàn tiền',
        resolvedBy: actorId,
        resolvedAt: new Date(),
        refundId: 'refund-uuid-4444',
        refundStatus: 'REQUESTED',
      };

      const mockDisputeService = {
        resolveDispute: vi.fn().mockResolvedValue(mockResult),
      } as unknown as OrderDisputeService;

      const controller = new SupportDisputeController(mockDisputeService);
      const response = await controller.resolve(disputeId, actorId, dto);

      expect(mockDisputeService.resolveDispute).toHaveBeenCalledWith(
        disputeId,
        actorId,
        dto,
      );
      expect(response).toEqual({
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Giải quyết khiếu nại đơn hàng thành công',
        data: mockResult,
      });
    });
  });

  describe('list', () => {
    it('gọi service và trả về cấu trúc response chuẩn kèm data và meta', async () => {
      const mockResult = {
        data: [
          {
            id: 'dispute-1',
            orderId: 'order-1',
            orderNumber: 'ORD-001',
            buyerId: 'buyer-1',
            buyer: {
              fullName: 'Buyer A',
              email: 'a@example.com',
              phone: '0123',
              status: 'ACTIVE',
            },
            sellerId: 'seller-1',
            sellerShop: {
              name: 'Shop 1',
              status: 'ACTIVE',
              logoUrl: null,
            },
            order: {
              status: 'DELIVERED',
              total: '100000.00',
              currency: 'VND',
            },
            reasonCategory: 'DAMAGED',
            evidenceDescription: 'Hỏng hóc',
            evidenceImages: [],
            status: 'PENDING_STAFF_REVIEW',
            staffDecisionNote: null,
            resolvedBy: null,
            resolvedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          totalItems: 1,
          totalPages: 1,
        },
      };

      const mockDisputeService = {
        listSupportDisputes: vi.fn().mockResolvedValue(mockResult),
      } as unknown as OrderDisputeService;

      const controller = new SupportDisputeController(mockDisputeService);
      const query: QuerySupportDisputesDto = { page: 1, limit: 20 };

      const response = await controller.list(query);

      expect(mockDisputeService.listSupportDisputes).toHaveBeenCalledWith(
        query,
      );
      expect(response).toEqual({
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Lấy danh sách khiếu nại đơn hàng hỗ trợ thành công',
        data: mockResult.data,
        meta: mockResult.meta,
      });
    });
  });
});
