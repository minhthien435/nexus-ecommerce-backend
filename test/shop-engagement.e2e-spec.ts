import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ShopEngagementController } from '../src/modules/catalog/controllers/shop-engagement.controller.js';
import { ShopEngagementService } from '../src/modules/catalog/services/shop-engagement.service.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';

describe('Shop follow and wishlist API', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const productId = '22222222-2222-4222-8222-222222222222';
  const follow = '/api/v1/catalog/shops/demo/follow';
  const wishlist = '/api/v1/catalog/wishlist';
  const engagement = {
    getFollow: vi.fn().mockResolvedValue({ following: true }),
    setFollow: vi
      .fn()
      .mockImplementation((_u, _s, following) => ({ following })),
    setWishlist: vi
      .fn()
      .mockImplementation((_u, _p, wishlisted) => ({ wishlisted })),
    wishlist: vi.fn().mockResolvedValue({ items: [] }),
  };
  let app: INestApplication;
  let auth: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'engagement-test-secret' })],
      controllers: [ShopEngagementController],
      providers: [
        { provide: ShopEngagementService, useValue: engagement },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: vi.fn().mockResolvedValue({ id: userId, tokenVersion: 0 }),
          },
        },
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
    auth =
      'Bearer ' +
      (await module
        .get(JwtService)
        .signAsync({ sub: userId, tokenVersion: 0 }));
  });
  afterAll(async () => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('protects all six personal endpoints', async () => {
    const api = request(app.getHttpServer());
    await api.get(follow).expect(401);
    await api.post(follow).expect(401);
    await api.delete(follow).expect(401);
    await api.get(wishlist).expect(401);
    await api.post(wishlist + '/' + productId).expect(401);
    await api.delete(wishlist + '/' + productId).expect(401);
  });
  it('reads, follows and unfollows using the authenticated user', async () => {
    const api = request(app.getHttpServer());
    await api
      .get(follow)
      .set('Authorization', auth)
      .expect(200, { following: true });
    await api
      .post(follow)
      .set('Authorization', auth)
      .expect(200, { following: true });
    await api
      .delete(follow)
      .set('Authorization', auth)
      .expect(200, { following: false });
    expect(engagement.getFollow).toHaveBeenCalledWith(userId, 'demo');
    expect(engagement.setFollow.mock.calls).toEqual([
      [userId, 'demo', true],
      [userId, 'demo', false],
    ]);
  });
  it('returns the scoped page and accepts add/remove for a product UUID', async () => {
    const api = request(app.getHttpServer());
    await api
      .get(wishlist + '?page=2&limit=3')
      .set('Authorization', auth)
      .expect(200);
    expect(engagement.wishlist).toHaveBeenCalledWith(userId, {
      page: 2,
      limit: 3,
    });
    await api
      .post(wishlist + '/' + productId)
      .set('Authorization', auth)
      .expect(200, { wishlisted: true });
    await api
      .delete(wishlist + '/' + productId)
      .set('Authorization', auth)
      .expect(200, { wishlisted: false });
    expect(engagement.setWishlist.mock.calls).toEqual([
      [userId, productId, true],
      [userId, productId, false],
    ]);
  });
  it('rejects invalid pagination and malformed product IDs', async () => {
    const api = request(app.getHttpServer());
    await api
      .get(wishlist + '?page=0&limit=101')
      .set('Authorization', auth)
      .expect(400);
    await api
      .post(wishlist + '/invalid')
      .set('Authorization', auth)
      .expect(400);
    expect(engagement.wishlist).not.toHaveBeenCalled();
    expect(engagement.setWishlist).not.toHaveBeenCalled();
  });
});
