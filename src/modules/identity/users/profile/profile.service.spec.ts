import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { ProfileService } from './profile.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const user = {
  id: userId,
  email: 'user@example.com',
  fullName: 'User',
  phone: null,
  preferredLanguage: null,
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
  const dataSource: any = {
    query: vi
      .fn()
      .mockResolvedValueOnce([{ code: 'CUSTOMER' }, { code: 'SELLER' }])
      .mockResolvedValueOnce([
        { trust_level: 'TRUSTED', score: 85, rewarded: false },
      ]),
  };
  const manager = { getRepository: () => users };
  dataSource.transaction = vi.fn(async (work) => work(manager));
  const reputation = {
    rewardProfileCompletion: vi.fn().mockResolvedValue(null),
  };
  const addresses = {
    list: vi.fn().mockResolvedValue([{ addressLine: 'Updated street' }]),
  };
  return {
    service: new ProfileService(
      users as never,
      dataSource as never,
      addresses as never,
      reputation as never,
    ),
    addresses,
    manager,
    reputation,
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
      reputationScore: 85,
      trustLevel: 'TRUSTED',
      profileCompletionRewarded: false,
      addresses: [{ addressLine: 'Updated street' }],
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
      reputationScore: 50,
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
    expect(test.reputation.rewardProfileCompletion).toHaveBeenCalledWith(
      userId,
      test.manager,
    );
    expect(test.execute.mock.invocationCallOrder[0]).toBeLessThan(
      test.reputation.rewardProfileCompletion.mock.invocationCallOrder[0],
    );
  });

  it('fails the PATCH transaction when the reward fails before reading a response', async () => {
    const test = setup();
    test.reputation.rewardProfileCompletion.mockRejectedValue(
      new Error('reward failed'),
    );
    await expect(
      test.service.updateProfile(userId, { fullName: 'Updated' }),
    ).rejects.toThrow('reward failed');
    expect(test.users.findOne).not.toHaveBeenCalled();
  });

  it('saves and reads a language-only change independently of completion rewards', async () => {
    const test = setup();
    test.users.findOne.mockResolvedValue({ ...user, preferredLanguage: 'vi' });
    await expect(
      test.service.updateProfile(userId, { preferredLanguage: 'vi' }),
    ).resolves.toMatchObject({ preferredLanguage: 'vi' });
    expect(test.builder.set).toHaveBeenCalledWith({ preferredLanguage: 'vi' });
    expect(test.users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ preferredLanguage: true }),
      }),
    );
    expect(test.reputation.rewardProfileCompletion).not.toHaveBeenCalled();
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
