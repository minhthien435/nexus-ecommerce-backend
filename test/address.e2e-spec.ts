import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { AddressController } from '../src/modules/identity/users/addresses/address.controller.js';
import { AddressService } from '../src/modules/identity/users/addresses/address.service.js';

const secret = 'address-test-secret';
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
  let token: string;
  const users = {
    findOne: vi.fn().mockResolvedValue({ id: userId, tokenVersion: 0 }),
  };
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
      imports: [JwtModule.register({ secret })],
      controllers: [AddressController],
      providers: [
        AccessTokenGuard,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: users,
        },
        { provide: AddressService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: userId, tokenVersion: 0 });
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('returns 401 when the bearer token is missing or invalid', async () => {
    await request(app.getHttpServer()).get('/users/addresses').expect(401);
    await request(app.getHttpServer())
      .get('/users/addresses')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('passes the current user to list', async () => {
    await request(app.getHttpServer())
      .get('/users/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, []);
    expect(service.list).toHaveBeenCalledWith(userId);
  });

  it('creates valid input and rejects invalid or unknown input', async () => {
    await request(app.getHttpServer())
      .post('/users/addresses')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
      .send({ ...valid, recipientName: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...valid, surprise: true })
      .expect(400);
  });

  it('rejects an empty patch and returns 204 for delete', async () => {
    await request(app.getHttpServer())
      .patch(`/users/addresses/${addressId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ addressLine: '34 Le Loi' })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(userId, addressId, {
      addressLine: '34 Le Loi',
    });

    await request(app.getHttpServer())
      .patch(`/users/addresses/${addressId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/users/addresses/${addressId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(service.remove).toHaveBeenCalledWith(userId, addressId);
  });
});
