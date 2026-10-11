import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { ProfileService } from './profile.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const user = {
  id: userId,
  email: 'user@example.com',
  fullName: 'User',
  phone: null,
  avatarUrl: null,
};

function setup() {
  const execute = vi.fn().mockResolvedValue({ affected: 1 });
  const builder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    execute,
  };
  const users = {
    findOne: vi.fn().mockResolvedValue(user),
    createQueryBuilder: vi.fn().mockReturnValue(builder),
  };
  const dataSource = {
    query: vi
      .fn()
      .mockResolvedValueOnce([{ code: 'CUSTOMER' }, { code: 'SELLER' }])
      .mockResolvedValueOnce([{ trust_level: 'TRUSTED' }]),
  };
  return {
    service: new ProfileService(users as never, dataSource as never),
    users,
    dataSource,
    builder,
    execute,
  };
}

describe('ProfileService', () => {
  it('returns only the public projection with distinct active roles and trust', async () => {
    const { service, users } = setup();
    const result = await service.getProfile(userId);

    expect(result).toEqual({
      ...user,
      roles: ['CUSTOMER', 'SELLER'],
      trustLevel: 'TRUSTED',
    });
    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ passwordHash: true }),
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
  });

  it('falls back to STANDARD and rejects missing or soft-deleted users', async () => {
    const fallback = setup();
    fallback.dataSource.query
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(fallback.service.getProfile(userId)).resolves.toMatchObject({
      trustLevel: 'STANDARD',
      roles: [],
    });

    const missing = setup();
    missing.users.findOne.mockResolvedValue(null);
    await expect(missing.service.getProfile(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('atomically updates only supplied fields and returns the public profile', async () => {
    const test = setup();
    await test.service.updateProfile(userId, {
      phone: null,
      avatarUrl: 'https://example.com/avatar.png',
    });

    expect(test.builder.set).toHaveBeenCalledWith({
      phone: null,
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(test.builder.where).toHaveBeenCalledWith('id = :id', { id: userId });
    expect(test.builder.andWhere).toHaveBeenCalledWith('deleted_at IS NULL');
  });

  it('maps phone uniqueness conflicts and concurrent soft-delete to HTTP errors', async () => {
    const conflict = setup();
    conflict.execute.mockRejectedValue({ code: '23505' });
    await expect(
      conflict.service.updateProfile(userId, { phone: '0912345678' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const deleted = setup();
    deleted.execute.mockResolvedValue({ affected: 0 });
    await expect(
      deleted.service.updateProfile(userId, { fullName: 'New name' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleted.users.findOne).not.toHaveBeenCalled();
  });

  it('re-throws unexpected database errors during updateProfile', async () => {
    const dbError = setup();
    dbError.execute.mockRejectedValue(new Error('Unexpected DB Error'));
    await expect(
      dbError.service.updateProfile(userId, { fullName: 'Test Name' }),
    ).rejects.toThrow('Unexpected DB Error');
  });
});
