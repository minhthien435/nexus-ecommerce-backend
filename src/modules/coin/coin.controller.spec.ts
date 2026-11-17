import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import { CoinController } from './coin.controller.js';
import { CoinService } from './coin.service.js';

describe('CoinController', () => {
  let app: INestApplication;
  const buyerId = '11111111-1111-4111-8111-111111111111';
  const service = {
    getWallet: vi.fn(),
    getTransactions: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CoinController],
      providers: [
        AccessTokenGuard,
        { provide: CoinService, useValue: service },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi
              .fn()
              .mockResolvedValue({ sub: buyerId, tokenVersion: 0 }),
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: vi
              .fn()
              .mockResolvedValue({ id: buyerId, tokenVersion: 0 }),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('uses the authenticated buyer for the wallet endpoint', async () => {
    const wallet = { balance: 10_000, availableBalance: 0 };
    service.getWallet.mockResolvedValue(wallet);

    await request(app.getHttpServer())
      .get('/api/v1/coins/me?userId=other')
      .set('Authorization', 'Bearer test')
      .expect(200, wallet);
    expect(service.getWallet).toHaveBeenCalledWith(buyerId);
  });

  it('defaults and bounds pagination for the history endpoint', async () => {
    service.getTransactions.mockResolvedValue({ items: [] });
    const server = request(app.getHttpServer());

    await server
      .get('/api/v1/coins/me/transactions')
      .set('Authorization', 'Bearer test')
      .expect(200);
    await server
      .get('/api/v1/coins/me/transactions?page=2&limit=200')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(service.getTransactions).toHaveBeenNthCalledWith(1, buyerId, 1, 20);
    expect(service.getTransactions).toHaveBeenNthCalledWith(2, buyerId, 2, 100);
  });

  it('guards both wallet endpoints', async () => {
    const server = request(app.getHttpServer());
    await server.get('/api/v1/coins/me').expect(401);
    await server.get('/api/v1/coins/me/transactions').expect(401);
    expect(service.getWallet).not.toHaveBeenCalled();
    expect(service.getTransactions).not.toHaveBeenCalled();
  });
});
