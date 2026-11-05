import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminShopService } from './admin-shop.service.js';

const shopId = '22222222-2222-4222-8222-222222222222';
const actorId = '11111111-1111-4111-8111-111111111111';
const shop = {
  id: shopId,
  sellerId: 'seller',
  name: 'Shop',
  slug: 'shop',
  headline: null,
  description: null,
  logoUrl: null,
  bannerUrl: null,
  phone: '0900',
  email: null,
  warehouseAddress: 'HCM',
  identityNumber: 'SECRET',
  status: 'ACTIVE',
  ratingAvg: '5.00',
  reviewCount: 0,
  followerCount: 0,
  reputationScore: 50,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  seller: {
    id: 'seller',
    fullName: 'Seller',
    email: 'seller@example.com',
    phone: '0900',
    status: 'ACTIVE',
  },
};

function qb(record = shop) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(record),
    getManyAndCount: vi.fn().mockResolvedValue([[record], 1]),
  };
}

describe('AdminShopService', () => {
  it('lists filtered shops with stable pagination and without identityNumber', async () => {
    const builder = qb();
    const service = new AdminShopService(
      { createQueryBuilder: vi.fn().mockReturnValue(builder) } as never,
      {} as never,
    );
    const result = await service.list({
      search: 'Shop',
      status: 'ACTIVE',
      page: 1,
      limit: 20,
    });
    expect(builder.orderBy).toHaveBeenCalledWith('shop.created_at', 'DESC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('shop.id', 'ASC');
    expect(result).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(result.items[0]).not.toHaveProperty('identityNumber');
  });

  it('returns a public seller projection and 404 for missing detail', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValueOnce(shop).mockResolvedValueOnce(null),
    };
    const service = new AdminShopService(repo as never, {} as never);
    const detail = await service.getById(shopId);
    expect(detail.seller).toEqual(shop.seller);
    expect(detail).not.toHaveProperty('identityNumber');
    await expect(service.getById(shopId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('locks and changes status with audit/outbox, then returns fresh detail', async () => {
    const builder = qb({ ...shop });
    const shopRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(builder),
      save: vi.fn(),
    };
    const auditRepo = { create: vi.fn((v) => v), save: vi.fn() };
    const outboxRepo = { create: vi.fn((v) => v), save: vi.fn() };
    const manager = {
      getRepository: vi.fn((entity: { name: string }) =>
        entity.name === 'ShopEntity'
          ? shopRepo
          : entity.name === 'AuditLogEntity'
            ? auditRepo
            : outboxRepo,
      ),
    };
    const readRepo = {
      findOne: vi.fn().mockResolvedValue({ ...shop, status: 'SUSPENDED' }),
    };
    const service = new AdminShopService(
      readRepo as never,
      { transaction: vi.fn(async (work) => work(manager)) } as never,
    );
    const result = await service.updateStatus(
      actorId,
      shopId,
      'SUSPENDED',
      'policy',
    );
    expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        changes: {
          previousStatus: 'ACTIVE',
          status: 'SUSPENDED',
          reason: 'policy',
        },
      }),
    );
    expect(outboxRepo.save).toHaveBeenCalled();
    expect(result.status).toBe('SUSPENDED');
  });

  it('returns stable 404 and 409 errors without side effects', async () => {
    for (const record of [null, { ...shop }]) {
      const builder = qb(record as never);
      const repo = {
        createQueryBuilder: vi.fn().mockReturnValue(builder),
        save: vi.fn(),
      };
      const manager = { getRepository: vi.fn().mockReturnValue(repo) };
      const service = new AdminShopService(
        {} as never,
        { transaction: vi.fn(async (work) => work(manager)) } as never,
      );
      await expect(
        service.updateStatus(actorId, shopId, 'ACTIVE', 'same'),
      ).rejects.toBeInstanceOf(record ? ConflictException : NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    }
  });
});
