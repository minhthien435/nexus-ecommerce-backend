import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { ROLES_KEY } from '../../identity/rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../../identity/rbac/guards/roles.guard.js';
import { OrderDisputeController } from './order-dispute.controller.js';
import type { OrderDisputeService } from '../services/order-dispute.service.js';
import type { CreateOrderDisputeDto } from '../dtos/create-order-dispute.dto.js';

describe('OrderDisputeController', () => {
  describe('Security Metadata', () => {
    it('bảo vệ endpoint bằng AccessTokenGuard và RolesGuard với quyền BUYER', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        OrderDisputeController,
      );
      expect(guards).toEqual([AccessTokenGuard, RolesGuard]);

      const roles = Reflect.getMetadata(ROLES_KEY, OrderDisputeController);
      expect(roles).toEqual(['BUYER']);
    });
  });

  describe('createDispute', () => {
    it('gọi service và trả về cấu trúc response chuẩn của Commerce', async () => {
      const mockResult = {
        id: 'dispute-123',
        orderId: 'order-123',
        orderNumber: 'ORD-999',
        buyerId: 'buyer-123',
        sellerId: 'seller-123',
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Bị rách bao bì khi giao tới',
        evidenceImages: ['https://example.com/img1.jpg'],
        status: 'PENDING_STAFF_REVIEW',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDisputeService = {
        createDispute: vi.fn().mockResolvedValue(mockResult),
      } as unknown as OrderDisputeService;

      const controller = new OrderDisputeController(mockDisputeService);
      const dto: CreateOrderDisputeDto = {
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Bị rách bao bì khi giao tới',
        evidenceImages: ['https://example.com/img1.jpg'],
      };

      const response = await controller.createDispute(
        'buyer-123',
        'order-123',
        dto,
      );

      expect(mockDisputeService.createDispute).toHaveBeenCalledWith(
        'buyer-123',
        'order-123',
        dto,
      );
      expect(response).toEqual({
        success: true,
        statusCode: HttpStatus.CREATED,
        message: 'Tạo hồ sơ khiếu nại đơn hàng thành công',
        data: mockResult,
      });
    });
  });
});
