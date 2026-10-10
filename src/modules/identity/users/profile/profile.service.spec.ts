import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ProfileUserEntity } from '../entities/profile-user.entity.js';
import { ProfileService } from './profile.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const user = Object.assign(new ProfileUserEntity(), {
  id: userId,
  email: 'a@example.com',
  fullName: 'A',
  phone: '0912345678',
  avatarUrl: null,
});

function setup() {
  const users = {
    findOne: vi.fn(async () => ({ ...user })),
    save: vi.fn(async (value) => value),
  } as unknown as Repository<ProfileUserEntity>;
  const dataSource = {
    query: vi.fn(async () => [
      { roles: ['CUSTOMER', 'SELLER'], trustLevel: 'TRUSTED' },
    ]),
  } as unknown as DataSource;
  return { service: new ProfileService(users, dataSource), users, dataSource };
}

describe('ProfileService', () => {
  it('returns an explicit public projection with distinct active roles and trust', async () => {
    const { service, dataSource } = setup();
    const result = await service.get(userId);
    expect(result).toEqual({
      ...user,
      roles: ['CUSTOMER', 'SELLER'],
      trustLevel: 'TRUSTED',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('r.deleted_at IS NULL'),
      [userId],
    );
  });

  it('falls back to STANDARD without a reputation row', async () => {
    const { service, dataSource } = setup();
    vi.mocked(dataSource.query).mockResolvedValue([
      { roles: [], trustLevel: null },
    ]);
    await expect(service.get(userId)).resolves.toMatchObject({
      roles: [],
      trustLevel: 'STANDARD',
    });
  });

  it('returns 404 for missing or soft-deleted current user', async () => {
    const { service, users } = setup();
    vi.mocked(users.findOne).mockResolvedValue(null);
    await expect(service.get(userId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only supplied fields and permits nullable values', async () => {
    const { service, users } = setup();
    await service.update(userId, { phone: null, avatarUrl: null });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'A', phone: null, avatarUrl: null }),
    );
  });

  it('maps database phone uniqueness violations to 409', async () => {
    const { service, users } = setup();
    vi.mocked(users.save).mockRejectedValue({ code: '23505' });
    await expect(
      service.update(userId, { phone: '0987654321' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
