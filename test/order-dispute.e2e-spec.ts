import {
  BadRequestException,
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
import { OrderDisputeController } from '../src/modules/commerce/controllers/order-dispute.controller.js';
import { OrderDisputeService } from '../src/modules/commerce/services/order-dispute.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const buyerId = '11111111-1111-4111-8111-111111111111';
const sellerId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const orderNumber = 'ORD-20261108-001';

describe('POST /api/v1/commerce/orders/:id/disputes (HTTP E2E)', () => {
  let app: INestApplication;
  let buyerToken: string;
  let sellerToken: string;

  const usersRepo = { findOne: vi.fn() };
  const rbacService = { hasAnyRole: vi.fn() };
  const disputeService = {
    createDispute: vi.fn(),
    getOrderDisputeByBuyer: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'dispute-test-secret' })],
      controllers: [OrderDisputeController],
      providers: [
        Reflector,
        AccessTokenGuard,
        RolesGuard,
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
        exceptionFactory: (errors) => {
          return new BadRequestException({
            errorCode: 'VALIDATION_ERROR',
            message: 'Dữ liệu không hợp lệ',
            errors,
          });
        },
      }),
    );
    await app.init();

    const jwt = module.get(JwtService);
    buyerToken = await jwt.signAsync({ sub: buyerId, tokenVersion: 0 });
    sellerToken = await jwt.signAsync({ sub: sellerId, tokenVersion: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    usersRepo.findOne.mockResolvedValue({ id: buyerId, tokenVersion: 0 });
    rbacService.hasAnyRole.mockImplementation(
      async (userId: string, roles: string[]) => {
        if (userId === buyerId && roles.includes('BUYER')) return true;
        return false;
      },
    );
  });

  it('1. Trả về 401 Unauthorized khi không có JWT header', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Hàng bị hư hỏng nặng khi giao tới',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('2. Trả về 403 Forbidden khi người gọi không có role BUYER (ví dụ SELLER)', async () => {
    usersRepo.findOne.mockResolvedValue({ id: sellerId, tokenVersion: 0 });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Hàng bị hư hỏng nặng khi giao tới',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('3. Trả về 400 Bad Request khi :id trên URL không phải là UUID hợp lệ', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/commerce/orders/not-a-valid-uuid/disputes')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Hàng bị hư hỏng nặng khi giao tới',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('4. Trả về 400 VALIDATION_ERROR khi body gửi sai lý do (không thuộc 6 mã FE)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'INVALID_REASON',
        evidenceDescription: 'Mô tả hợp lệ nhưng lý do không thuộc enum',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('5. Trả về 400 VALIDATION_ERROR khi mô tả quá ngắn (< 5 ký tự)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'lỗi',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('6. Trả về 400 VALIDATION_ERROR khi vượt quá 5 ảnh bằng chứng', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Đầy đủ mô tả lỗi của hàng hóa',
        evidenceImages: [
          'https://nexus.com/img1.jpg',
          'https://nexus.com/img2.jpg',
          'https://nexus.com/img3.jpg',
          'https://nexus.com/img4.jpg',
          'https://nexus.com/img5.jpg',
          'https://nexus.com/img6.jpg',
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(disputeService.createDispute).not.toHaveBeenCalled();
  });

  it('7. Trả về 201 Created khi tạo khiếu nại thành công với đầy đủ dữ liệu theo hợp đồng FE', async () => {
    const mockCreatedDispute = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      orderId,
      orderNumber,
      buyerId,
      sellerId,
      reasonCategory: 'DAMAGED',
      evidenceDescription: 'Gói hàng bị ướt và vỡ góc màn hình khi bóc seal.',
      evidenceImages: ['https://storage.nexus.com/evidence1.jpg'],
      status: 'PENDING_STAFF_REVIEW',
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
      updatedAt: new Date('2026-11-08T00:00:00.000Z'),
    };

    disputeService.createDispute.mockResolvedValue(mockCreatedDispute);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Gói hàng bị ướt và vỡ góc màn hình khi bóc seal.',
        evidenceImages: ['https://storage.nexus.com/evidence1.jpg'],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      statusCode: 201,
      message: 'Tạo hồ sơ khiếu nại đơn hàng thành công',
      data: {
        id: mockCreatedDispute.id,
        orderId: mockCreatedDispute.orderId,
        orderNumber: mockCreatedDispute.orderNumber,
        buyerId: mockCreatedDispute.buyerId,
        sellerId: mockCreatedDispute.sellerId,
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Gói hàng bị ướt và vỡ góc màn hình khi bóc seal.',
        evidenceImages: ['https://storage.nexus.com/evidence1.jpg'],
        status: 'PENDING_STAFF_REVIEW',
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z',
      },
    });
    expect(disputeService.createDispute).toHaveBeenCalledWith(
      buyerId,
      orderId,
      {
        reasonCategory: 'DAMAGED',
        evidenceDescription: 'Gói hàng bị ướt và vỡ góc màn hình khi bóc seal.',
        evidenceImages: ['https://storage.nexus.com/evidence1.jpg'],
      },
    );
  });

  it('8. Trả về 409 DISPUTE_ALREADY_EXISTS khi đơn hàng đã có khiếu nại trước đó', async () => {
    disputeService.createDispute.mockRejectedValue(
      new ConflictException({
        errorCode: 'DISPUTE_ALREADY_EXISTS',
        message: 'Đơn hàng này đã có hồ sơ khiếu nại đang được xử lý',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'WRONG_ITEM',
        evidenceDescription: 'Giao nhầm mã hàng so với đơn đặt',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('DISPUTE_ALREADY_EXISTS');
    expect(res.body.message).toBe(
      'Đơn hàng này đã có hồ sơ khiếu nại đang được xử lý',
    );
  });

  it('9. Trả về 409 ORDER_STATUS_INVALID khi đơn hàng chưa ở trạng thái DELIVERED', async () => {
    disputeService.createDispute.mockRejectedValue(
      new ConflictException({
        errorCode: 'ORDER_STATUS_INVALID',
        message:
          'Chỉ có thể khiếu nại đơn hàng ở trạng thái đã giao (DELIVERED). Trạng thái hiện tại: SHIPPED',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'MISSING_PARTS',
        evidenceDescription: 'Thiếu phụ kiện sạc đi kèm',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('ORDER_STATUS_INVALID');
  });

  it('10. Trả về 400 DISPUTE_WINDOW_EXPIRED khi thời hạn 72 giờ đã kết thúc', async () => {
    disputeService.createDispute.mockRejectedValue(
      new BadRequestException({
        errorCode: 'DISPUTE_WINDOW_EXPIRED',
        message: 'Thời hạn khiếu nại 72 giờ kể từ khi nhận hàng đã kết thúc',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'NOT_AS_DESCRIBED',
        evidenceDescription: 'Sản phẩm không đúng như mô tả trên shop',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('DISPUTE_WINDOW_EXPIRED');
  });

  it('11. Trả về 404 ORDER_NOT_FOUND khi đơn hàng không tồn tại hoặc không thuộc về Buyer', async () => {
    disputeService.createDispute.mockRejectedValue(
      new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Không tìm thấy đơn hàng yêu cầu khiếu nại',
      }),
    );

    const res = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/disputes`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'COUNTERFEIT',
        evidenceDescription: 'Nghi ngờ hàng giả tem nhãn',
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('ORDER_NOT_FOUND');
  });

  it('12. Hỗ trợ đường dẫn chuẩn hóa số ít POST & GET /api/v1/commerce/orders/:id/dispute', async () => {
    const mockDispute = {
      id: 'dispute-singular-1',
      orderId,
      orderNumber,
      buyerId,
      sellerId,
      reasonCategory: 'DAMAGED',
      evidenceDescription: 'Sản phẩm bị bể góc hộp và thiếu phụ kiện kèm theo.',
      evidenceImages: [],
      status: 'PENDING_STAFF_REVIEW',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    disputeService.createDispute.mockResolvedValueOnce(mockDispute);
    disputeService.getOrderDisputeByBuyer.mockResolvedValueOnce(mockDispute);

    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/dispute`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        reasonCategory: 'DAMAGED',
        evidenceDescription:
          'Sản phẩm bị bể góc hộp và thiếu phụ kiện kèm theo.',
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.data.id).toBe('dispute-singular-1');

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/commerce/orders/${orderNumber}/dispute`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe('dispute-singular-1');
    expect(disputeService.getOrderDisputeByBuyer).toHaveBeenCalledWith(
      buyerId,
      orderNumber,
    );
  });
});
