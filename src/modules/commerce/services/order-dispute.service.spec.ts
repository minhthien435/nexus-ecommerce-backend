import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderDisputeService } from './order-dispute.service.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderDisputeEntity } from '../domain/entities/order-dispute.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import type { CreateOrderDisputeDto } from '../dtos/create-order-dispute.dto.js';
import type { ResolveOrderDisputeDto } from '../dtos/resolve-order-dispute.dto.js';
import type { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import type { OrderStateMachineService } from './order-state-machine.service.js';
import type { OrderRefundService } from './order-refund.service.js';

describe('OrderDisputeService', () => {
  let service: OrderDisputeService;
  let mockEntityManager: Partial<EntityManager>;
  let mockDataSource: Partial<DataSource>;
  let mockDisputeRepo: Partial<Repository<OrderDisputeEntity>>;
  let mockIdentityLookup: Partial<IdentitySupportLookupApi>;
  let mockOrderStateMachine: Partial<OrderStateMachineService>;
  let mockOrderRefundService: Partial<OrderRefundService>;

  const buyerId = '11111111-1111-1111-1111-111111111111';
  const otherBuyerId = '22222222-2222-2222-2222-222222222222';
  const orderId = '33333333-3333-3333-3333-333333333333';
  const sellerId = '44444444-4444-4444-4444-444444444444';
  const staffActorId = '99999999-9999-9999-9999-999999999999';

  const validDto: CreateOrderDisputeDto = {
    reasonCategory: 'DAMAGED',
    evidenceDescription:
      'Gói hàng bị ướt và hỏng góc màn hình khi mở hộp kiểm tra.',
    evidenceImages: ['https://storage.nexus.com/evidence1.jpg'],
  };

  const mockOrder: Partial<OrderEntity> = {
    id: orderId,
    orderNumber: 'ORD-20261107-001',
    buyerId,
    sellerId,
    status: 'DELIVERED',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupService(params: {
    order?: Partial<OrderEntity> | null;
    existingDispute?: Partial<OrderDisputeEntity> | null;
    disputeToResolve?: Partial<OrderDisputeEntity> | null;
    payment?: Partial<PaymentEntity> | null;
    deliveryHistory?: Partial<OrderStatusHistoryEntity> | null;
    saveThrowsError?: unknown;
    disputesList?: any[];
    totalItems?: number;
  }) {
    const orderQueryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(params.order ?? null),
    };

    const disputeQueryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getOne: vi
        .fn()
        .mockResolvedValue(
          params.disputeToResolve !== undefined
            ? params.disputeToResolve
            : (params.existingDispute ?? null),
        ),
      getManyAndCount: vi
        .fn()
        .mockResolvedValue([
          params.disputesList ?? [],
          params.totalItems ??
            (params.disputesList ? params.disputesList.length : 0),
        ]),
    };

    const paymentQueryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(params.payment ?? null),
    };

    mockDisputeRepo = {
      findOne: vi.fn().mockResolvedValue(params.existingDispute ?? null),
      create: vi.fn().mockImplementation((input) => ({
        ...input,
        id: 'dispute-uuid-1234',
        createdAt: new Date('2026-11-07T12:00:00Z'),
        updatedAt: new Date('2026-11-07T12:00:00Z'),
      })),
      save: vi.fn().mockImplementation(async (dispute) => {
        if (params.saveThrowsError) {
          throw params.saveThrowsError;
        }
        return dispute;
      }),
      createQueryBuilder: vi.fn().mockReturnValue(disputeQueryBuilder),
    };

    const historyRepo = {
      findOne: vi.fn().mockResolvedValue(params.deliveryHistory ?? null),
    };

    mockEntityManager = {
      getRepository: vi.fn().mockImplementation((entity) => {
        if (entity === OrderEntity) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(orderQueryBuilder),
          };
        }
        if (entity === OrderDisputeEntity) {
          return mockDisputeRepo;
        }
        if (entity === OrderStatusHistoryEntity) {
          return historyRepo;
        }
        if (entity === PaymentEntity) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(paymentQueryBuilder),
          };
        }
        return {};
      }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (_isolation, callback) => {
        return callback(mockEntityManager as EntityManager);
      }),
    };

    mockIdentityLookup = {
      findBuyerIdsByEmail: vi.fn().mockResolvedValue([buyerId]),
      getUsersByIds: vi.fn().mockResolvedValue([
        {
          id: buyerId,
          fullName: 'Nguyễn Văn Người Mua',
          email: 'buyer@example.com',
          phone: '0901234567',
          status: 'ACTIVE',
        },
      ]),
      getShopsBySellerIds: vi.fn().mockResolvedValue([
        {
          sellerId,
          name: 'Nexus Official Store',
          status: 'ACTIVE',
          logoUrl: 'https://storage.nexus.com/logo.png',
        },
      ]),
    };

    mockOrderStateMachine = {
      transition: vi.fn().mockResolvedValue(mockOrder as OrderEntity),
    };

    mockOrderRefundService = {
      requestFullRefund: vi.fn().mockResolvedValue({
        refundId: 'refund-uuid-5678',
        status: 'REQUESTED' as const,
      }),
    };

    const mockOrderRepo = {
      findOne: vi.fn().mockResolvedValue(params.order ?? null),
    };

    service = new OrderDisputeService(
      mockDataSource as DataSource,
      mockDisputeRepo as Repository<OrderDisputeEntity>,
      mockOrderRepo as any,
      {} as any,
      mockIdentityLookup as IdentitySupportLookupApi,
      mockOrderStateMachine as OrderStateMachineService,
      mockOrderRefundService as OrderRefundService,
    );

    return { disputeQueryBuilder, mockOrderRepo };
  }

  describe('createDispute (Buyer)', () => {
    it('tạo hồ sơ khiếu nại thành công khi thỏa mãn toàn bộ điều kiện', async () => {
      const recentDelivery = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 giờ trước (trong hạn 72h)
      setupService({
        order: mockOrder,
        existingDispute: null,
        deliveryHistory: {
          id: 'hist-1',
          orderId,
          toStatus: 'DELIVERED',
          createdAt: recentDelivery,
        },
      });

      const result = await service.createDispute(buyerId, orderId, validDto);

      expect(result).toBeDefined();
      expect(result.id).toBe('dispute-uuid-1234');
      expect(result.orderId).toBe(orderId);
      expect(result.orderNumber).toBe('ORD-20261107-001');
      expect(result.buyerId).toBe(buyerId);
      expect(result.sellerId).toBe(sellerId);
      expect(result.reasonCategory).toBe('DAMAGED');
      expect(result.evidenceDescription).toBe(validDto.evidenceDescription);
      expect(result.evidenceImages).toEqual(validDto.evidenceImages);
      expect(result.status).toBe('PENDING_STAFF_REVIEW');
    });

    it('ném lỗi 404 ORDER_NOT_FOUND nếu không tìm thấy đơn hàng', async () => {
      setupService({ order: null });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném lỗi 404 ORDER_NOT_FOUND nếu đơn hàng thuộc người mua khác', async () => {
      setupService({ order: { ...mockOrder, buyerId: otherBuyerId } });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném lỗi 409 ORDER_STATUS_INVALID nếu đơn hàng chưa ở trạng thái DELIVERED', async () => {
      setupService({ order: { ...mockOrder, status: 'SHIPPED' } });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('ném lỗi 409 DISPUTE_ALREADY_EXISTS nếu đơn hàng đã có khiếu nại trước đó', async () => {
      setupService({
        order: mockOrder,
        existingDispute: { id: 'existing-dispute-id', orderId },
      });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('ném lỗi 409 ORDER_STATUS_INVALID nếu không tìm thấy bản ghi lịch sử DELIVERED', async () => {
      setupService({
        order: mockOrder,
        existingDispute: null,
        deliveryHistory: null,
      });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('ném lỗi 400 DISPUTE_WINDOW_EXPIRED nếu thời điểm nhận hàng đã quá 72 giờ', async () => {
      const expiredDelivery = new Date(Date.now() - 73 * 60 * 60 * 1000); // 73 giờ trước
      setupService({
        order: mockOrder,
        existingDispute: null,
        deliveryHistory: {
          id: 'hist-expired',
          orderId,
          toStatus: 'DELIVERED',
          createdAt: expiredDelivery,
        },
      });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném lỗi 409 DISPUTE_ALREADY_EXISTS khi xảy ra xung đột unique constraint đồng thời (error 23505)', async () => {
      const recentDelivery = new Date(Date.now() - 10 * 60 * 60 * 1000);
      setupService({
        order: mockOrder,
        existingDispute: null,
        deliveryHistory: {
          id: 'hist-2',
          orderId,
          toStatus: 'DELIVERED',
          createdAt: recentDelivery,
        },
        saveThrowsError: { code: '23505' },
      });

      await expect(
        service.createDispute(buyerId, orderId, validDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listSupportDisputes (Support Desk)', () => {
    it('truy vấn danh sách khiếu nại với phân trang mặc định và làm giàu thông tin Buyer/SellerShop', async () => {
      const mockDisputeRecord = {
        id: 'dispute-1',
        orderId,
        buyerId,
        sellerId,
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Bị móp méo vỏ hộp',
        evidenceImages: ['https://storage.nexus.com/img1.jpg'],
        status: 'PENDING_STAFF_REVIEW',
        staffDecisionNote: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date('2026-11-08T00:00:00Z'),
        updatedAt: new Date('2026-11-08T00:00:00Z'),
        order: {
          id: orderId,
          orderNumber: 'ORD-20261108-999',
          status: 'DELIVERED',
          total: '500000.00',
          currency: 'VND',
        },
      };

      setupService({
        disputesList: [mockDisputeRecord],
        totalItems: 1,
      });

      const result = await service.listSupportDisputes({});

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        totalItems: 1,
        totalPages: 1,
      });

      const item = result.data[0];
      expect(item.id).toBe('dispute-1');
      expect(item.orderNumber).toBe('ORD-20261108-999');
      expect(item.buyer).toEqual({
        fullName: 'Nguyễn Văn Người Mua',
        email: 'buyer@example.com',
        phone: '0901234567',
        status: 'ACTIVE',
      });
      expect(item.sellerShop).toEqual({
        name: 'Nexus Official Store',
        status: 'ACTIVE',
        logoUrl: 'https://storage.nexus.com/logo.png',
      });
      expect(item.order).toEqual({
        status: 'DELIVERED',
        total: '500000.00',
        currency: 'VND',
      });
    });

    it('trả về danh sách rỗng khi tìm theo buyerEmail không tồn tại', async () => {
      setupService({});
      (mockIdentityLookup.findBuyerIdsByEmail as any).mockResolvedValueOnce([]);

      const result = await service.listSupportDisputes({
        buyerEmail: 'notfound@example.com',
      });

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
      });
    });

    it('áp dụng các filter status, reasonCategory, sellerId, fromDate, toDate, q', async () => {
      setupService({
        disputesList: [],
        totalItems: 0,
      });

      const result = await service.listSupportDisputes({
        page: 2,
        limit: 10,
        status: 'PENDING_STAFF_REVIEW',
        reasonCategory: 'COUNTERFEIT',
        sellerId,
        q: 'ORD-123',
        fromDate: '2026-11-01',
        toDate: '2026-11-08',
      });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(mockDisputeRepo.createQueryBuilder).toHaveBeenCalledWith(
        'dispute',
      );
    });

    it('Dispute pending + Order DELIVERED: xuất hiện trong danh sách kết quả và áp dụng điều kiện lọc DELIVERED', async () => {
      const mockDeliveredDispute = {
        id: 'disp-delivered-1',
        orderId: 'ord-delivered-1',
        buyerId,
        sellerId,
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Bể vỡ khi nhận',
        evidenceImages: [],
        status: 'PENDING_STAFF_REVIEW',
        staffDecisionNote: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date('2026-11-08T10:00:00Z'),
        updatedAt: new Date('2026-11-08T10:00:00Z'),
        order: {
          id: 'ord-delivered-1',
          orderNumber: 'ORD-2026-DELIVERED',
          status: 'DELIVERED',
          total: '350000.00',
          currency: 'VND',
        },
      };

      const { disputeQueryBuilder } = setupService({
        disputesList: [mockDeliveredDispute],
        totalItems: 1,
      });

      const result = await service.listSupportDisputes({});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('disp-delivered-1');
      expect(result.data[0].status).toBe('PENDING_STAFF_REVIEW');
      expect(result.data[0].order?.status).toBe('DELIVERED');
      expect(disputeQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(dispute.status != :pendingDisputeStatus OR order.status = :validOrderPendingStatus)',
        {
          pendingDisputeStatus: 'PENDING_STAFF_REVIEW',
          validOrderPendingStatus: 'DELIVERED',
        },
      );
    });

    it('Dispute pending + Order REFUND_REQUESTED: áp dụng điều kiện lọc loại trừ khỏi danh sách', async () => {
      const { disputeQueryBuilder } = setupService({
        disputesList: [],
        totalItems: 0,
      });

      const result = await service.listSupportDisputes({
        status: 'PENDING_STAFF_REVIEW',
      });

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalItems).toBe(0);
      expect(disputeQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(dispute.status != :pendingDisputeStatus OR order.status = :validOrderPendingStatus)',
        {
          pendingDisputeStatus: 'PENDING_STAFF_REVIEW',
          validOrderPendingStatus: 'DELIVERED',
        },
      );
    });
  });

  describe('resolveDispute (Support / Admin)', () => {
    const disputeId = 'dispute-uuid-9999';
    const mockPendingDispute: Partial<OrderDisputeEntity> = {
      id: disputeId,
      orderId,
      buyerId,
      sellerId,
      status: 'PENDING_STAFF_REVIEW',
      reasonCategory: 'DAMAGED',
      evidenceDescription: 'Hỏng hóc màn hình',
      evidenceImages: [],
      staffDecisionNote: null,
      resolvedBy: null,
      resolvedAt: null,
    };

    const mockPayment: Partial<PaymentEntity> = {
      id: 'payment-uuid-1111',
      orderId,
      status: 'SUCCEEDED',
      amount: '500000.00',
      currency: 'VND',
    };

    it('giải quyết thành công với quyết định ACCEPTED_REFUND: chuyển order sang REFUND_REQUESTED và tạo refund', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'DELIVERED' },
        payment: { ...mockPayment },
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote:
          'Chấp thuận hoàn tiền do hàng hóa bị hỏng trong quá trình vận chuyển.',
      };

      const result = await service.resolveDispute(disputeId, staffActorId, dto);

      expect(result).toBeDefined();
      expect(result.id).toBe(disputeId);
      expect(result.status).toBe('ACCEPTED_REFUND');
      expect(result.staffDecisionNote).toBe(dto.staffDecisionNote.trim());
      expect(result.resolvedBy).toBe(staffActorId);
      expect(result.resolvedAt).toBeInstanceOf(Date);
      expect(result.refundId).toBe('refund-uuid-5678');
      expect(result.refundStatus).toBe('REQUESTED');

      expect(mockOrderStateMachine.transition).toHaveBeenCalledWith(
        mockEntityManager,
        expect.objectContaining({
          orderId,
          toStatus: 'REFUND_REQUESTED',
          actorId: staffActorId,
          reason: `DISPUTE_ACCEPTED:${disputeId}`,
        }),
      );

      expect(mockOrderRefundService.requestFullRefund).toHaveBeenCalledWith(
        orderId,
        staffActorId,
        dto.staffDecisionNote.trim(),
        mockEntityManager,
      );
    });

    it('giải quyết thành công với quyết định REJECTED_PAY_SELLER: chuyển order sang COMPLETED và không tạo refund', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'DELIVERED' },
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'REJECTED_PAY_SELLER',
        staffDecisionNote:
          'Bác bỏ khiếu nại do người mua không cung cấp được video mở hộp hợp lệ.',
      };

      const result = await service.resolveDispute(disputeId, staffActorId, dto);

      expect(result).toBeDefined();
      expect(result.id).toBe(disputeId);
      expect(result.status).toBe('REJECTED_PAY_SELLER');
      expect(result.staffDecisionNote).toBe(dto.staffDecisionNote.trim());
      expect(result.resolvedBy).toBe(staffActorId);
      expect(result.resolvedAt).toBeInstanceOf(Date);
      expect(result.refundId).toBeUndefined();
      expect(result.refundStatus).toBeUndefined();

      expect(mockOrderStateMachine.transition).toHaveBeenCalledWith(
        mockEntityManager,
        expect.objectContaining({
          orderId,
          toStatus: 'COMPLETED',
          actorId: staffActorId,
          reason: `DISPUTE_REJECTED:${disputeId}`,
        }),
      );

      expect(mockOrderRefundService.requestFullRefund).not.toHaveBeenCalled();
    });

    it('ném lỗi NotFoundException DISPUTE_NOT_FOUND nếu không tìm thấy khiếu nại', async () => {
      setupService({
        disputeToResolve: null,
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném lỗi ConflictException DISPUTE_ALREADY_RESOLVED nếu khiếu nại không ở trạng thái PENDING_STAFF_REVIEW', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute, status: 'ACCEPTED_REFUND' },
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('ném lỗi NotFoundException ORDER_NOT_FOUND nếu không tìm thấy đơn hàng tương ứng', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: null,
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('ném lỗi ConflictException ORDER_STATUS_INVALID nếu đơn hàng không ở trạng thái DELIVERED', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'SHIPPED' },
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('ném lỗi ConflictException ORDER_STATUS_INVALID (409) nếu đơn hàng ở trạng thái REFUND_REQUESTED (như đơn bị lỗi dữ liệu)', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'REFUND_REQUESTED' },
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('transaction lỗi giữa chừng (requestFullRefund thất bại): rollback và không lưu cập nhật Dispute', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'DELIVERED' },
        payment: { ...mockPayment },
      });

      (mockOrderRefundService.requestFullRefund as any).mockRejectedValueOnce(
        new Error('Payment gateway timeout during refund'),
      );

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Chấp thuận hoàn tiền hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow('Payment gateway timeout during refund');

      expect(mockDisputeRepo.save).not.toHaveBeenCalled();
    });

    it('ném lỗi ConflictException REFUND_PAYMENT_NOT_FOUND nếu ACCEPTED_REFUND nhưng không có payment SUCCEEDED', async () => {
      setupService({
        disputeToResolve: { ...mockPendingDispute },
        order: { ...mockOrder, status: 'DELIVERED' },
        payment: null,
      });

      const dto: ResolveOrderDisputeDto = {
        decision: 'ACCEPTED_REFUND',
        staffDecisionNote: 'Lý do xử lý hợp lệ.',
      };

      await expect(
        service.resolveDispute(disputeId, staffActorId, dto),
      ).rejects.toThrow(ConflictException);
    });
  });
});
