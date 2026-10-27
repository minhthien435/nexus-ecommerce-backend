import { ConflictException, NotFoundException } from '@nestjs/common';
import { RefreshTokenEntity } from '../domain/refresh-token.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { RoleEntity } from '../rbac/entities/role.entity.js';
import { AuditLogEntity } from '../domain/audit-log.entity.js';
import { IdentityOutboxEntity } from '../domain/identity-outbox.entity.js';
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

    const roleRepo = {
      findOne: vi
        .fn()
        .mockResolvedValue({ id: 'admin-role-id', code: 'ADMIN' }),
    };
    const userRoleRepo = {
      exists: vi.fn().mockResolvedValue(false),
    };
    const auditRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => data),
    };
    const outboxRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => data),
    };

    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === UserEntity)
          return { createQueryBuilder: () => lockBuilder, save };
        if (entity === RefreshTokenEntity) return { update };
        if (entity === RoleEntity) return roleRepo;
        if (entity === UserRoleEntity) return userRoleRepo;
        if (entity === AuditLogEntity) return auditRepo;
        if (entity === IdentityOutboxEntity) return outboxRepo;
        return {};
      }),
    };

    const roleMapBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi
        .fn()
        .mockResolvedValue([{ user_id: userId, code: 'BUYER' }]),
    };

    const users = { findOne: vi.fn().mockImplementation(async () => record) };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
      getRepository: vi.fn((entity) => {
        if (entity === UserRoleEntity) {
          return { createQueryBuilder: () => roleMapBuilder };
        }
        return {};
      }),
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

    const countBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(1),
    };

    const roleRepo = {
      findOne: vi
        .fn()
        .mockResolvedValue({ id: 'admin-role-id', code: 'ADMIN' }),
    };
    const userRoleRepo = {
      exists: vi.fn().mockResolvedValue(true),
      delete: roleDelete,
    };

    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === UserEntity)
          return {
            createQueryBuilder: (alias?: string) =>
              alias === 'u' ? countBuilder : lockBuilder,
          };
        if (entity === RoleEntity) return roleRepo;
        if (entity === UserRoleEntity) return userRoleRepo;
        return {};
      }),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };
    const service = new AdminUserService({} as never, dataSource as never);

    await expect(
      service.revokeRole(actorId, userId, 'ADMIN'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(roleDelete).not.toHaveBeenCalled();
  });

  it('assigns a role to a user using TypeORM query builder', async () => {
    const record = user();
    const lockBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(record),
    };

    const insertBuilder = {
      insert: vi.fn().mockReturnThis(),
      into: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ identifiers: [] }),
    };

    const roleRepo = {
      findOne: vi
        .fn()
        .mockResolvedValue({ id: 'seller-role-id', code: 'SELLER' }),
    };
    const userRoleRepo = {
      createQueryBuilder: vi.fn(() => insertBuilder),
    };
    const auditRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => data),
    };
    const outboxRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => data),
    };

    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity === UserEntity)
          return { createQueryBuilder: () => lockBuilder };
        if (entity === RoleEntity) return roleRepo;
        if (entity === UserRoleEntity) return userRoleRepo;
        if (entity === AuditLogEntity) return auditRepo;
        if (entity === IdentityOutboxEntity) return outboxRepo;
        return {};
      }),
    };

    const roleMapBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { user_id: userId, code: 'BUYER' },
        { user_id: userId, code: 'SELLER' },
      ]),
    };

    const users = { findOne: vi.fn().mockImplementation(async () => record) };
    const dataSource = {
      transaction: vi.fn(async (work) => work(manager)),
      getRepository: vi.fn((entity) => {
        if (entity === UserRoleEntity) {
          return { createQueryBuilder: () => roleMapBuilder };
        }
        return {};
      }),
    };
    const service = new AdminUserService(users as never, dataSource as never);

    const result = await service.assignRole(actorId, userId, 'SELLER');

    expect(insertBuilder.execute).toHaveBeenCalled();
    expect(auditRepo.save).toHaveBeenCalled();
    expect(outboxRepo.save).toHaveBeenCalled();
    expect(result.roles).toEqual(['BUYER', 'SELLER']);
  });

  it('throws NotFoundException when role does not exist', async () => {
    const record = user();
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
        if (entity === RoleEntity)
          return { findOne: vi.fn().mockResolvedValue(null) };
        return {};
      }),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };
    const service = new AdminUserService({} as never, dataSource as never);

    await expect(
      service.assignRole(actorId, userId, 'NON_EXISTENT'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
