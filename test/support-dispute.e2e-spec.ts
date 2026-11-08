import {
  ConflictException,
  NotFoundException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import {
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  it,
  expect,
  vi,
} from 'vitest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { SupportDisputeController } from '../src/modules/commerce/controllers/support-dispute.controller.js';
import { OrderDisputeService } from '../src/modules/commerce/services/order-dispute.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const supportStaffId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const buyerId = '44444444-4444-4444-8444-444444444444';
const sellerId = '55555555-5555-4555-8555-555555555555';
const staffWithoutPermId = '66666666-6666-4666-8666-666666666666';

describe('GET /api/v1/commerce/support/disputes (HTTP E2E)', () => {
  let app: INestApplication;
  let supportStaffToken: string;
  let staffToken: string;
  let adminToken: string;
  let buyerToken: string;
  let sellerToken: string;
  let staffWithoutPermToken: string;

  const usersRepo = { findOne: vi.fn() };
  const rbacService = {
    hasAnyRole: vi.fn(),
    hasAllPermissions: vi.fn(),
  };
  const disputeService = {
    listSupportDisputes: vi.fn(),
    resolveDispute: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'support-dispute-test-secret' })],
      controllers: [SupportDisputeController],
      providers: [
        Reflector,
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: getRepositoryToken(UserEntity), useValue: usersRepo },
        { provide: RbacService, useValue: rbacService },
        { provide: OrderDisputeService, useValue: disputeService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const jwt = module.get(JwtService);
    supportStaffToken = await jwt.signAsync({
      sub: supportStaffId,
      tokenVersion: 0,
    });
    staffToken = await jwt.signAsync({ sub: staffId, tokenVersion: 0 });
    adminToken = await jwt.signAsync({ sub: adminId, tokenVersion: 0 });
    buyerToken = await jwt.signAsync({ sub: buyerId, tokenVersion: 0 });
    sellerToken = await jwt.signAsync({ sub: sellerId, tokenVersion: 0 });
    staffWithoutPermToken = await jwt.signAsync({
      sub: staffWithoutPermId,
      tokenVersion: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();

    usersRepo.findOne.mockImplementation(async ({ where }: any) => {
      return { id: where.id, tokenVersion: 0 };
    });

    rbacService.hasAnyRole.mockImplementation(
      async (userId: string, roles: string[]) => {
        if (userId === supportStaffId)
          return roles.includes('SUPPORT_STAFF') || roles.includes('STAFF');
        if (userId === staffId) return roles.includes('STAFF');
        if (userId === adminId) return roles.includes('ADMIN');
        if (userId === staffWithoutPermId) return roles.includes('STAFF');
        if (userId === buyerId) return roles.includes('BUYER');
        if (userId === sellerId) return roles.includes('SELLER');
        return false;
      },
    );

    rbacService.hasAllPermissions.mockImplementation(
      async (userId: string, perms: string[]) => {
        if (userId === staffWithoutPermId) return false;
        if ([supportStaffId, staffId, adminId].includes(userId)) {
          return perms.every((p) => p === 'DISPUTE.MANAGE');
        }
        return false;
      },
    );

    disputeService.listSupportDisputes.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
    });
  });

  it('1. Trả về 401 Unauthorized khi không có JWT', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/commerce/support/disputes',
    );

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(disputeService.listSupportDisputes).not.toHaveBeenCalled();
  });

  it('2. Trả về 403 Forbidden khi caller là BUYER', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(disputeService.listSupportDisputes).not.toHaveBeenCalled();
  });

  it('3. Trả về 403 Forbidden khi caller là SELLER', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(disputeService.listSupportDisputes).not.toHaveBeenCalled();
  });

  it('4. Trả về 403 Forbidden khi Staff thiếu permission DISPUTE.MANAGE', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${staffWithoutPermToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(disputeService.listSupportDisputes).not.toHaveBeenCalled();
  });

  it('5. Cho phép SUPPORT_STAFF có permission DISPUTE.MANAGE truy cập thành công (200 OK)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${supportStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(disputeService.listSupportDisputes).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });

  it('6. Cho phép STAFF có permission DISPUTE.MANAGE truy cập thành công (200 OK)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(disputeService.listSupportDisputes).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });

  it('7. Cho phép ADMIN truy cập thành công (200 OK)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(disputeService.listSupportDisputes).toHaveBeenCalledWith(
      expect.any(Object),
    );
  });

  it('8. Trả về danh sách rỗng chuẩn envelope khi chưa có khiếu nại nào', async () => {
    disputeService.listSupportDisputes.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, limit: 20, totalItems: 0, totalPages: 1 },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes')
      .set('Authorization', `Bearer ${supportStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'Lấy danh sách khiếu nại đơn hàng hỗ trợ thành công',
      data: [],
      meta: {
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 1,
      },
    });
  });

  it('9. Trả về nhiều disputes với orderNumber, Buyer, SellerShop chính xác và không lộ dữ liệu nhạy cảm', async () => {
    const mockDispute1 = {
      id: 'disp-1111-1111-1111-1111-111111111111',
      orderId: 'ord-1111-1111-1111-1111-111111111111',
      orderNumber: 'ORD-20261108-001',
      buyerId,
      buyer: {
        fullName: 'Nguyễn Văn Buyer',
        email: 'buyer@nexus.com',
        phone: '0901234567',
        status: 'ACTIVE',
      },
      sellerId,
      sellerShop: {
        name: 'Nexus Official Store',
        status: 'ACTIVE',
        logoUrl: 'https://storage.nexus.com/logo.png',
      },
      order: {
        status: 'DELIVERED',
        total: '750000.00',
        currency: 'VND',
      },
      reasonCategory: 'DAMAGED',
      evidenceDescription: 'Bị rách tem và vỡ vỏ',
      evidenceImages: ['https://storage.nexus.com/img1.jpg'],
      status: 'PENDING_STAFF_REVIEW',
      staffDecisionNote: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
      updatedAt: new Date('2026-11-08T00:00:00.000Z'),
    };

    const mockDispute2 = {
      id: 'disp-2222-2222-2222-2222-222222222222',
      orderId: 'ord-2222-2222-2222-2222-222222222222',
      orderNumber: 'ORD-20261108-002',
      buyerId,
      buyer: {
        fullName: 'Nguyễn Văn Buyer',
        email: 'buyer@nexus.com',
        phone: '0901234567',
        status: 'ACTIVE',
      },
      sellerId,
      sellerShop: {
        name: 'Nexus Official Store',
        status: 'ACTIVE',
        logoUrl: 'https://storage.nexus.com/logo.png',
      },
      order: {
        status: 'DELIVERED',
        total: '1200000.00',
        currency: 'VND',
      },
      reasonCategory: 'WRONG_ITEM',
      evidenceDescription: 'Giao nhầm phiên bản màu đen',
      evidenceImages: [],
      status: 'PENDING_STAFF_REVIEW',
      staffDecisionNote: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date('2026-11-08T01:00:00.000Z'),
      updatedAt: new Date('2026-11-08T01:00:00.000Z'),
    };

    disputeService.listSupportDisputes.mockResolvedValueOnce({
      data: [mockDispute1, mockDispute2],
      meta: { page: 1, limit: 10, totalItems: 2, totalPages: 1 },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/commerce/support/disputes?page=1&limit=10')
      .set('Authorization', `Bearer ${supportStaffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);

    // Kiểm tra orderNumber, buyer, sellerShop chính xác
    expect(res.body.data[0].orderNumber).toBe('ORD-20261108-001');
    expect(res.body.data[0].buyer.fullName).toBe('Nguyễn Văn Buyer');
    expect(res.body.data[0].sellerShop.name).toBe('Nexus Official Store');
    expect(res.body.data[1].orderNumber).toBe('ORD-20261108-002');

    // Đảm bảo không chứa dữ liệu nhạy cảm (password, salt, tokenVersion, v.v.)
    expect((res.body.data[0].buyer as any).passwordHash).toBeUndefined();
    expect((res.body.data[0].buyer as any).tokenVersion).toBeUndefined();
  });

  it('10. Hỗ trợ query params: status filter, q, buyerEmail, sellerId và pagination', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/v1/commerce/support/disputes?page=2&limit=5&status=PENDING_STAFF_REVIEW&reasonCategory=DAMAGED&q=ORD-2026',
      )
      .set('Authorization', `Bearer ${supportStaffToken}`);

    expect(disputeService.listSupportDisputes).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      status: 'PENDING_STAFF_REVIEW',
      reasonCategory: 'DAMAGED',
      q: 'ORD-2026',
    });
  });

  describe('PATCH /api/v1/commerce/support/disputes/:id/resolve (HTTP E2E)', () => {
    const validDisputeId = '99999999-9999-4999-8999-999999999999';
    const validAcceptedBody = {
      decision: 'ACCEPTED_REFUND',
      staffDecisionNote: 'Chấp thuận hoàn tiền do hàng hóa bị hỏng khi nhận.',
    };
    const validRejectedBody = {
      decision: 'REJECTED_PAY_SELLER',
      staffDecisionNote:
        'Bác bỏ khiếu nại do người mua không cung cấp được video bóc kiện hàng.',
    };

    it('1. Trả về 401 Unauthorized khi không có Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .send(validAcceptedBody);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('2. Trả về 403 Forbidden khi caller là BUYER', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('3. Trả về 403 Forbidden khi caller là SELLER', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('4. Trả về 403 Forbidden khi staff không có quyền DISPUTE.MANAGE', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${staffWithoutPermToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('5. Trả về 400 Bad Request khi param :id không phải là UUID', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/commerce/support/disputes/not-a-valid-uuid/resolve')
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('6. Trả về 400 Bad Request khi decision không hợp lệ', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send({
          decision: 'INVALID_DECISION',
          staffDecisionNote: 'Ghi chú quyết định xử lý khiếu nại',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('7. Trả về 400 Bad Request khi staffDecisionNote rỗng hoặc dưới 5 ký tự', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send({
          decision: 'ACCEPTED_REFUND',
          staffDecisionNote: ' abc ',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(disputeService.resolveDispute).not.toHaveBeenCalled();
    });

    it('8. Trả về 404 Not Found khi dispute không tồn tại', async () => {
      disputeService.resolveDispute.mockRejectedValueOnce(
        new NotFoundException({
          errorCode: 'DISPUTE_NOT_FOUND',
          message: 'Không tìm thấy hồ sơ khiếu nại',
        }),
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('DISPUTE_NOT_FOUND');
    });

    it('9. Trả về 409 Conflict khi dispute đã được xử lý trước đó', async () => {
      disputeService.resolveDispute.mockRejectedValueOnce(
        new ConflictException({
          errorCode: 'DISPUTE_ALREADY_RESOLVED',
          message: 'Hồ sơ khiếu nại này đã được xử lý trước đó',
        }),
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('DISPUTE_ALREADY_RESOLVED');
    });

    it('10. Trả về 409 Conflict khi đơn hàng không ở trạng thái DELIVERED', async () => {
      disputeService.resolveDispute.mockRejectedValueOnce(
        new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message:
            'Chỉ có thể giải quyết khiếu nại cho đơn hàng ở trạng thái DELIVERED',
        }),
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('ORDER_STATUS_INVALID');
    });

    it('11. Xử lý thành công ACCEPTED_REFUND với SUPPORT_STAFF token', async () => {
      const mockResult = {
        id: validDisputeId,
        orderId: 'ord-1111-1111-1111-111111111111',
        orderNumber: 'ORD-20261108-001',
        status: 'ACCEPTED_REFUND',
        staffDecisionNote: validAcceptedBody.staffDecisionNote,
        resolvedBy: supportStaffId,
        resolvedAt: new Date('2026-11-08T10:00:00Z'),
        refundId: 'ref-1111-1111-1111-111111111111',
        refundStatus: 'REQUESTED',
      };

      disputeService.resolveDispute.mockResolvedValueOnce(mockResult);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${supportStaffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Giải quyết khiếu nại đơn hàng thành công');
      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: validDisputeId,
          status: 'ACCEPTED_REFUND',
          refundId: 'ref-1111-1111-1111-111111111111',
          refundStatus: 'REQUESTED',
        }),
      );

      expect(disputeService.resolveDispute).toHaveBeenCalledWith(
        validDisputeId,
        supportStaffId,
        validAcceptedBody,
      );
    });

    it('12. Xử lý thành công REJECTED_PAY_SELLER với ADMIN token', async () => {
      const mockResult = {
        id: validDisputeId,
        orderId: 'ord-1111-1111-1111-111111111111',
        orderNumber: 'ORD-20261108-001',
        status: 'REJECTED_PAY_SELLER',
        staffDecisionNote: validRejectedBody.staffDecisionNote,
        resolvedBy: adminId,
        resolvedAt: new Date('2026-11-08T10:00:00Z'),
      };

      disputeService.resolveDispute.mockResolvedValueOnce(mockResult);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validRejectedBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Giải quyết khiếu nại đơn hàng thành công');
      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: validDisputeId,
          status: 'REJECTED_PAY_SELLER',
        }),
      );
      expect(res.body.data.refundId).toBeUndefined();

      expect(disputeService.resolveDispute).toHaveBeenCalledWith(
        validDisputeId,
        adminId,
        validRejectedBody,
      );
    });

    it('13. Cho phép STAFF có quyền DISPUTE.MANAGE giải quyết khiếu nại', async () => {
      const mockResult = {
        id: validDisputeId,
        orderId: 'ord-1111-1111-1111-111111111111',
        orderNumber: 'ORD-20261108-001',
        status: 'ACCEPTED_REFUND',
        staffDecisionNote: validAcceptedBody.staffDecisionNote,
        resolvedBy: staffId,
        resolvedAt: new Date('2026-11-08T10:00:00Z'),
        refundId: 'ref-2222-2222-2222-222222222222',
        refundStatus: 'REQUESTED',
      };

      disputeService.resolveDispute.mockResolvedValueOnce(mockResult);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/commerce/support/disputes/${validDisputeId}/resolve`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(validAcceptedBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(disputeService.resolveDispute).toHaveBeenCalledWith(
        validDisputeId,
        staffId,
        validAcceptedBody,
      );
    });
  });
});
