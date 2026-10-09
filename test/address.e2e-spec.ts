import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AddressController } from '../src/modules/identity/address/address.controller.js';
import { AddressService } from '../src/modules/identity/address/address.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const addressId = '22222222-2222-4222-8222-222222222222';
const valid = {
  recipientName: 'Nguyen Van A',
  provinceCode: '001',
  districtCode: '002',
  wardCode: '003',
  addressLine: '12 Nguyen Trai',
  recipientPhone: '0912345678',
};

describe('AddressController (e2e)', () => {
  let app: INestApplication;
  const service = {
    list: vi.fn(async () => []),
    create: vi.fn(async (_userId, input) => ({ id: addressId, ...input })),
    update: vi.fn(async (_userId, id, input) => {
      if (Object.keys(input).length === 0) throw new BadRequestException();
      return { id, ...input };
    }),
    remove: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AddressController],
      providers: [{ provide: AddressService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: Request & { user?: { id: string } },
        _res: Response,
        next: NextFunction,
      ) => {
        const id = req.header('x-test-user');
        if (id) req.user = { id };
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('returns 401 when current user is missing', async () => {
    await request(app.getHttpServer()).get('/users/addresses').expect(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('passes the current user to list', async () => {
    await request(app.getHttpServer())
      .get('/users/addresses')
      .set('x-test-user', userId)
      .expect(200, []);
    expect(service.list).toHaveBeenCalledWith(userId);
  });

  it('creates valid input and rejects invalid or unknown input', async () => {
    await request(app.getHttpServer())
      .post('/users/addresses')
      .set('x-test-user', userId)
      .send(valid)
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        recipientName: valid.recipientName,
        isDefault: false,
      }),
    );

    await request(app.getHttpServer())
      .post('/users/addresses')
      .set('x-test-user', userId)
      .send({ ...valid, recipientName: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users/addresses')
      .set('x-test-user', userId)
      .send({ ...valid, surprise: true })
      .expect(400);
  });

  it('rejects an empty patch and returns 204 for delete', async () => {
    await request(app.getHttpServer())
      .patch(`/users/addresses/${addressId}`)
      .set('x-test-user', userId)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/users/addresses/${addressId}`)
      .set('x-test-user', userId)
      .expect(204);
    expect(service.remove).toHaveBeenCalledWith(userId, addressId);
  });
});
