import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SellerShopService } from './seller-shop.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-01T00:00:00.000Z');
const dto = {
  name: 'Gốm Sứ Việt',
  phone: '0912345678',
  warehouseAddress: 'Hà Nội, Việt Nam',
  identityNumber: '012345678901',
};

function queryBuilder(result: unknown) {
  return {
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(result),
    getExists: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    into: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orIgnore: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ identifiers: [] }),
  };
}

function setup(options?: {
  user?: null | { id: string; status: string };
  duplicateShop?: boolean;
  nameExists?: boolean;
  slugExists?: boolean[];
  sellerRole?: null | { id: string };
}) {
  const savedShop = {
    id: shopId,
    sellerId: userId,
    name: dto.name,
    slug: 'gom-su-viet',
    headline: null,
    description: null,
    logoUrl: null,
    bannerUrl: null,
    phone: dto.phone,
    email: null,
    warehouseAddress: dto.warehouseAddress,
    identityNumber: dto.identityNumber,
    status: 'ACTIVE',
    ratingAvg: '5.00',
    reviewCount: 0,
    followerCount: 0,
    reputationScore: 50,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const userQb = queryBuilder(
    options?.user === undefined
      ? { id: userId, status: 'ACTIVE' }
      : options.user,
  );
  const nameQb = queryBuilder(options?.nameExists ?? false);
  const slugValues = [...(options?.slugExists ?? [false])];
  const shopRepo = {
    exists: vi.fn().mockResolvedValue(options?.duplicateShop ?? false),
    createQueryBuilder: vi.fn(() => {
      if (shopRepo.createQueryBuilder.mock.calls.length === 1) return nameQb;
      return queryBuilder(slugValues.shift() ?? false);
    }),
    create: vi.fn((value) => ({ ...value })),
    save: vi.fn(async (value) => ({ ...savedShop, ...value })),
    findOne: vi.fn().mockResolvedValue(savedShop),
  };
  const roleRepo = {
    findOne: vi
      .fn()
      .mockResolvedValue(
        options?.sellerRole === undefined
          ? { id: '33333333-3333-4333-8333-333333333333' }
          : options.sellerRole,
      ),
  };
  const membershipQb = queryBuilder(null);
  const membershipRepo = {
    createQueryBuilder: vi.fn().mockReturnValue(membershipQb),
  };
  const manager = {
    getRepository: vi.fn((entity: { name?: string }) => {
      if (entity.name === 'UserEntity')
        return { createQueryBuilder: vi.fn().mockReturnValue(userQb) };
      if (entity.name === 'ShopEntity') return shopRepo;
      if (entity.name === 'RoleEntity') return roleRepo;
      if (entity.name === 'UserRoleEntity') return membershipRepo;
      throw new Error(`Unexpected repository ${entity.name}`);
    }),
    update: vi.fn().mockResolvedValue({ affected: 2 }),
    query: vi.fn().mockResolvedValue([{ code: 'BUYER' }, { code: 'SELLER' }]),
  };
  const dataSource = {
    transaction: vi.fn(async (work) => work(manager)),
    getRepository: vi.fn().mockReturnValue(shopRepo),
  };
  return {
    service: new SellerShopService(dataSource as never),
    dataSource,
    manager,
    shopRepo,
    membershipQb,
    savedShop,
  };
}

describe('SellerShopService', () => {
  it('atomically registers a safe shop, assigns SELLER, and links products', async () => {
    const test = setup();

    const result = await test.service.registerShop(userId, dto);

    expect(test.dataSource.transaction).toHaveBeenCalledOnce();
    expect(test.membershipQb.orIgnore).toHaveBeenCalledOnce();
    expect(test.manager.update).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ sellerId: userId }),
      { shopId },
    );
    expect(result.roles).toEqual(['BUYER', 'SELLER']);
    expect(result).not.toHaveProperty('identityNumber');
  });

  it('uses a deterministic suffix when the requested slug is occupied', async () => {
    const test = setup({ slugExists: [true, false] });

    const result = await test.service.registerShop(userId, {
      ...dto,
      slug: 'gom-su-viet',
    });

    expect(result.slug).toBe('gom-su-viet-2');
  });

  it('rejects duplicate ownership and duplicate names before assigning a role', async () => {
    const duplicate = setup({ duplicateShop: true });
    await expect(
      duplicate.service.registerShop(userId, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(duplicate.membershipQb.execute).not.toHaveBeenCalled();

    const name = setup({ nameExists: true });
    await expect(name.service.registerShop(userId, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(name.membershipQb.execute).not.toHaveBeenCalled();
  });

  it('rejects missing and inactive accounts without partial assignment', async () => {
    const missing = setup({ user: null });
    await expect(
      missing.service.registerShop(userId, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.shopRepo.save).not.toHaveBeenCalled();

    const suspended = setup({ user: { id: userId, status: 'SUSPENDED' } });
    await expect(
      suspended.service.registerShop(userId, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(suspended.shopRepo.save).not.toHaveBeenCalled();
  });

  it('fails the transaction when SELLER role is not configured', async () => {
    const test = setup({ sellerRole: null });
    await expect(test.service.registerShop(userId, dto)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(test.manager.query).not.toHaveBeenCalled();
  });

  it('keeps role projection inside the transaction failure boundary', async () => {
    const test = setup();
    test.manager.query.mockRejectedValue(new Error('role read failed'));
    await expect(test.service.registerShop(userId, dto)).rejects.toThrow(
      'role read failed',
    );
    expect(test.dataSource.transaction).toHaveBeenCalledOnce();
  });

  it('retries a concurrent slug collision and allocates the next suffix', async () => {
    const test = setup({ slugExists: [true, false] });
    test.dataSource.transaction
      .mockRejectedValueOnce({
        code: '23505',
        constraint: 'UQ_identity_shops_active_slug',
      })
      .mockImplementationOnce(async (work) => work(test.manager));
    await expect(
      test.service.registerShop(userId, { ...dto, slug: 'gom-su-viet' }),
    ).resolves.toMatchObject({ slug: 'gom-su-viet-2' });
    expect(test.dataSource.transaction).toHaveBeenCalledTimes(2);
  });

  it('maps concurrent unique violations to stable conflicts', async () => {
    const test = setup();
    test.dataSource.transaction.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_identity_shops_active_seller',
    });
    await expect(test.service.registerShop(userId, dto)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reads and updates only the owned shop and rejects empty updates', async () => {
    const test = setup();
    await expect(test.service.getMyShop(userId)).resolves.toMatchObject({
      id: shopId,
      sellerId: userId,
    });
    await expect(test.service.updateMyShop(userId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const updated = await test.service.updateMyShop(userId, {
      headline: 'Tinh hoa Việt',
      logoUrl: null,
    });
    expect(updated.headline).toBe('Tinh hoa Việt');
    expect(updated.logoUrl).toBeNull();
    expect(updated).not.toHaveProperty('identityNumber');
  });

  it('does not leak another shop when the current seller owns none', async () => {
    const test = setup();
    test.shopRepo.findOne.mockResolvedValue(null);
    await expect(test.service.getMyShop(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      test.service.updateMyShop(userId, { headline: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
