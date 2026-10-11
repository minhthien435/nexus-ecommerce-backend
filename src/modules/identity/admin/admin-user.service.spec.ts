import { ConflictException } from '@nestjs/common';
import { RefreshTokenEntity } from '../domain/refresh-token.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { AdminUserService } from './admin-user.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';

function user() {
  return Object.assign(new UserEntity(), {
    id: userId,
    email: 'user@example.com',
    phone: null,
    fullName: 'User',
    identityNumber: null,
    gender: null,
    address: null,
    dateOfBirth: null,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
    failedLoginAttempts: 2,
    lockedUntil: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
}

describe('AdminUserService', () => {
  it('locks an account, invalidates sessions and returns a safe projection', async () => {
    const record = user();
    const save = vi.fn(async (value) => value);
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const lockBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(record),
    };
    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === UserEntity)
          return { createQueryBuilder: () => lockBuilder, save };
        if (entity === RefreshTokenEntity) return { update };
        return {};
      }),
      query: vi
        .fn()
        .mockResolvedValueOnce([{ is_admin: false, active_admins: '1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const users = { findOne: vi.fn().mockImplementation(async () => record) };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
      query: vi.fn().mockResolvedValue([{ user_id: userId, code: 'BUYER' }]),
    };
    const service = new AdminUserService(users as never, dataSource as never);

    const result = await service.lock(actorId, userId);

    expect(record.status).toBe('LOCKED');
    expect(record.tokenVersion).toBe(2);
    expect(record.failedLoginAttempts).toBe(0);
    expect(record.lockedUntil).toBeNull();
    expect(update).toHaveBeenCalled();
    expect(result.roles).toEqual(['BUYER']);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('protects the last active administrator from role revocation', async () => {
    const record = user();
    const roleDelete = vi.fn();
    const lockBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(record),
    };
    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === UserEntity)
          return { createQueryBuilder: () => lockBuilder };
        if (entity === UserRoleEntity) return { delete: roleDelete };
        return {};
      }),
      query: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'admin-role', code: 'ADMIN' }])
        .mockResolvedValueOnce([{ is_admin: true, active_admins: '1' }]),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };
    const service = new AdminUserService({} as never, dataSource as never);

    await expect(
      service.revokeRole(actorId, userId, 'ADMIN'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(roleDelete).not.toHaveBeenCalled();
  });
});
