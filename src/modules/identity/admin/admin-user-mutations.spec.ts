import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserEntity } from '../domain/user.entity.js';
import { RefreshTokenEntity } from '../domain/refresh-token.entity.js';
import { AuditLogEntity } from '../domain/audit-log.entity.js';
import { IdentityOutboxEntity } from '../domain/identity-outbox.entity.js';
import { RoleEntity } from '../rbac/entities/role.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { AdminUserService } from './admin-user.service.js';
import { ListUsersQueryDto } from './dtos/list-users-query.dto.js';

function fixture() {
  const user: UserEntity = Object.assign(new UserEntity(), {
    id: 'target',
    email: 'test@example.com',
    fullName: 'Test',
    status: 'ACTIVE',
    passwordHash: null,
    lockedUntil: null,
    failedLoginAttempts: 0,
    tokenVersion: 2,
  });
  const memberships = new Set(['BUYER']);
  const order: string[] = [];
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'innerJoin',
    'insert',
    'into',
    'orIgnore',
  ])
    query[method] = vi.fn().mockReturnValue(query);
  query.setLock = vi.fn(() => {
    order.push('user');
    return query;
  });
  query.getOne = vi.fn(async () => user);
  query.getCount = vi.fn(async () => 2);
  query.getManyAndCount = vi.fn(async () => [[user], 1]);
  query.getRawMany = vi.fn(async () =>
    [...memberships].map((code) => ({ user_id: user.id, code })),
  );
  let pendingRole = '';
  query.values = vi.fn(({ roleId }: { roleId: string }) => {
    pendingRole = roleId;
    return query;
  });
  query.execute = vi.fn(async () => {
    memberships.add(pendingRole);
  });
  const users = {
    createQueryBuilder: vi.fn(() => query),
    findOne: vi.fn(async () => user),
    save: vi.fn(async (value) => value),
  };
  const roles = {
    findOne: vi.fn(async ({ where }: { where: { code: string } }) =>
      ['ADMIN', 'BUYER', 'SELLER'].includes(where.code)
        ? { id: where.code, code: where.code }
        : null,
    ),
  };
  const links = {
    createQueryBuilder: vi.fn(() => query),
    exists: vi.fn(async ({ where }: { where: { roleId: string } }) =>
      memberships.has(where.roleId),
    ),
    delete: vi.fn(async ({ roleId }: { roleId: string }) => ({
      affected: memberships.delete(roleId) ? 1 : 0,
    })),
  };
  const sessions = { update: vi.fn(async () => ({ affected: 1 })) };
  const audit = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const outbox = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
  };
  const manager = {
    query: vi.fn(async () => {
      order.push('global');
    }),
    getRepository: vi.fn((entity) => {
      if (entity === UserEntity) return users;
      if (entity === RoleEntity) return roles;
      if (entity === UserRoleEntity) return links;
      if (entity === RefreshTokenEntity) return sessions;
      if (entity === AuditLogEntity) return audit;
      if (entity === IdentityOutboxEntity) return outbox;
      throw new Error('Unexpected repository');
    }),
  };
  const rollback = vi.fn();
  const dataSource = {
    getRepository: manager.getRepository,
    transaction: vi.fn(async (work) => {
      const snapshot = new Set(memberships);
      try {
        return await work(manager);
      } catch (error) {
        memberships.clear();
        snapshot.forEach((code) => memberships.add(code));
        rollback();
        throw error;
      }
    }),
  };
  return {
    service: new AdminUserService(users as never, dataSource as never),
    user,
    query,
    users,
    roles,
    links,
    sessions,
    audit,
    outbox,
    manager,
    memberships,
    rollback,
    order,
    dataSource,
  };
}

describe('Admin user transactional mutations', () => {
  it.each(['lock', 'setStatus', 'revokeRole', 'changeRoles'] as const)(
    'blocks mixed-case UUID self mutations through %s before starting a transaction',
    async (method) => {
      const lowerId = 'abcdef01-abcd-4abc-8abc-abcdef012345';
      const mixedId = 'AbCdEf01-aBcD-4AbC-8aBc-AbCdEf012345';
      for (const [actorId, userId] of [
        [lowerId, mixedId],
        [mixedId, lowerId],
      ]) {
        const f = fixture();
        const action = () => {
          switch (method) {
            case 'lock':
              return f.service.lock(actorId, userId);
            case 'setStatus':
              return f.service.setStatus(actorId, userId, 'LOCKED');
            case 'revokeRole':
              return f.service.revokeRole(actorId, userId, 'ADMIN');
            case 'changeRoles':
              return f.service.changeRoles(actorId, userId, [], ['ADMIN']);
          }
        };
        await expect(action()).rejects.toBeInstanceOf(ConflictException);
        expect(f.dataSource.transaction).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['lock', 'revokeRole'] as const)(
    'blocks self admin removal through legacy %s',
    async (method) => {
      const f = fixture();
      await expect(
        method === 'lock'
          ? f.service.lock('target', 'target')
          : f.service.revokeRole('target', 'target', 'ADMIN'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(f.users.save).not.toHaveBeenCalled();
    },
  );

  it('allows removing an inactive admin without affecting the last active admin', async () => {
    const f = fixture();
    f.user.status = 'LOCKED';
    f.memberships.add('ADMIN');
    f.query.getCount.mockResolvedValue(1);
    await f.service.revokeRole('actor', 'target', 'ADMIN');
    expect(f.memberships.has('ADMIN')).toBe(false);
    expect(f.query.getCount).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'batch'])(
    'does not emit assignment events for an unchanged %s membership',
    async (mode) => {
      const f = fixture();
      await (mode === 'legacy'
        ? f.service.assignRole('actor', 'target', 'BUYER')
        : f.service.changeRoles('actor', 'target', ['BUYER']));
      expect(f.audit.save).not.toHaveBeenCalled();
      expect(f.outbox.save).not.toHaveBeenCalled();
      expect(f.query.execute).not.toHaveBeenCalled();
    },
  );
  it('serializes competing admin removals so the final active administrator survives', async () => {
    const first = fixture();
    const second = fixture();
    let activeAdmins = 2;
    let tail = Promise.resolve();
    for (const f of [first, second]) {
      f.memberships.add('ADMIN');
      let release: () => void = () => undefined;
      f.manager.query.mockImplementation(async () => {
        const previous = tail;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        f.order.push('global');
      });
      f.query.getCount.mockImplementation(async () => activeAdmins);
      f.users.save.mockImplementation(async (value) => {
        activeAdmins -= 1;
        return value;
      });
      const transaction = f.dataSource.transaction.getMockImplementation()!;
      f.dataSource.transaction.mockImplementation(async (work) => {
        try {
          return await transaction(work);
        } finally {
          release();
        }
      });
    }
    const results = await Promise.allSettled([
      first.service.lock('actor', 'target'),
      second.service.softDelete('actor', 'target'),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(activeAdmins).toBe(1);
    expect(first.order).toEqual(['global', 'user']);
    expect(second.order).toEqual(['global', 'user']);
    expect(first.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(16420, 1)',
    );
    expect(second.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(16420, 1)',
    );
  });

  it('lists with filters, pagination, stable sorting and safe fields', async () => {
    const f = fixture();
    const input = Object.assign(new ListUsersQueryDto(), {
      search: 'Test',
      status: 'ACTIVE',
      role: 'BUYER',
      page: 2,
      limit: 5,
    });
    const result = await f.service.list(input);
    expect(result).toMatchObject({
      page: 2,
      limit: 5,
      total: 1,
      totalPages: 1,
    });
    expect(result.items[0]).not.toHaveProperty('passwordHash');
    expect(f.query.orderBy).toHaveBeenCalledWith('user.full_name', 'ASC');
    expect(f.query.addOrderBy).toHaveBeenCalledWith('user.id', 'ASC');
    expect(f.query.skip).toHaveBeenCalledWith(5);
    const predicate = f.query.andWhere.mock.calls.find(
      ([value]) => typeof value === 'function',
    )![0];
    const sub = {
      subQuery: () => sub,
      select: () => sub,
      from: () => sub,
      innerJoin: () => sub,
      where: () => sub,
      getQuery: () => '(SELECT 1)',
    };
    expect(predicate(sub)).toBe('EXISTS (SELECT 1)');
  });

  it('lists empty pages without loading roles', async () => {
    const f = fixture();
    f.query.getManyAndCount.mockResolvedValue([[], 0]);
    expect((await f.service.list(new ListUsersQueryDto())).items).toEqual([]);
    expect(f.query.getRawMany).not.toHaveBeenCalled();
  });

  it('returns an empty roles array when there are no active roles', async () => {
    const f = fixture();
    f.memberships.clear();
    expect((await f.service.getById('target')).roles).toEqual([]);
  });

  it('loads roles using the canonical database UUID for mixed-case paths', async () => {
    const f = fixture();
    f.user.id = 'abcdef12-3456-4789-abcd-123456789abc';
    const result = await f.service.getById(f.user.id.toUpperCase());
    expect(result.roles).toEqual(['BUYER']);
    expect(f.query.where).toHaveBeenCalledWith('ur.userId IN (:...userIds)', {
      userIds: [f.user.id],
    });
  });

  it('rejects a missing detail', async () => {
    const f = fixture();
    f.users.findOne.mockResolvedValue(null as never);
    await expect(f.service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sets a manual lock, includes actor and reason in audit/outbox, and revokes tokens', async () => {
    const f = fixture();
    f.user.lockedUntil = new Date();
    const result = await f.service.setStatus(
      'actor',
      'target',
      'LOCKED',
      'Policy violation',
    );
    expect(result.status).toBe('LOCKED');
    expect(f.user.lockedUntil).toBeNull();
    expect(f.user.tokenVersion).toBe(3);
    expect(f.sessions.update).toHaveBeenCalled();
    expect(f.audit.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor',
        changes: {
          previousStatus: 'ACTIVE',
          status: 'LOCKED',
          reason: 'Policy violation',
        },
      }),
    );
    expect(f.outbox.save).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ actorId: 'actor' }),
      }),
    );
    expect(f.order.slice(0, 2)).toEqual(['global', 'user']);
  });

  it('unlocks and clears a temporary deadline', async () => {
    const f = fixture();
    f.user.status = 'LOCKED';
    f.user.lockedUntil = new Date();
    expect((await f.service.unlock('actor', 'target')).status).toBe('ACTIVE');
    expect(f.user.lockedUntil).toBeNull();
  });

  it('does not invalidate sessions for a status no-op', async () => {
    const f = fixture();
    await f.service.setStatus('actor', 'target', 'ACTIVE');
    expect(f.sessions.update).not.toHaveBeenCalled();
  });

  it.each(['ACTIVE', 'LOCKED'] as const)(
    'rejects suspended transition to %s',
    async (status) => {
      const f = fixture();
      f.user.status = 'SUSPENDED';
      await expect(
        f.service.setStatus('actor', 'target', status),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(f.users.save).not.toHaveBeenCalled();
    },
  );

  it('rejects self lock before mutation', async () => {
    const f = fixture();
    await expect(
      f.service.setStatus('target', 'target', 'LOCKED'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.manager.query).not.toHaveBeenCalled();
  });

  it.each(['lock', 'softDelete'] as const)(
    'protects the last admin during %s',
    async (method) => {
      const f = fixture();
      f.memberships.add('ADMIN');
      f.query.getCount.mockResolvedValue(1);
      await expect(f.service[method]('actor', 'target')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.order).toEqual(['global', 'user']);
    },
  );

  it('soft deletes and invalidates sessions', async () => {
    const f = fixture();
    await f.service.softDelete('actor', 'target');
    expect(f.user.deletedAt).toBeInstanceOf(Date);
    expect(f.user.tokenVersion).toBe(3);
    expect(f.sessions.update).toHaveBeenCalled();
  });

  it('allows removal if the ADMIN role does not exist', async () => {
    const f = fixture();
    f.roles.findOne.mockResolvedValue(null);
    await f.service.softDelete('actor', 'target');
    expect(f.users.save).toHaveBeenCalled();
  });

  it('assigns idempotently and preserves BUYER', async () => {
    const f = fixture();
    await f.service.changeRoles('actor', 'target', ['SELLER']);
    const result = await f.service.changeRoles('actor', 'target', ['SELLER']);
    expect(result.roles).toEqual(['BUYER', 'SELLER']);
  });

  it('atomically assigns and revokes with an updated view', async () => {
    const f = fixture();
    const result = await f.service.changeRoles(
      'actor',
      'target',
      ['SELLER'],
      ['BUYER'],
    );
    expect(result.roles).toEqual(['SELLER']);
    expect(f.audit.save).toHaveBeenCalledTimes(2);
  });

  it.each([
    [[], []],
    [['BUYER'], ['BUYER']],
    [['SELLER', 'SELLER'], []],
  ])(
    'rejects empty/overlapping/duplicate role changes',
    async (assign, revoke) => {
      const f = fixture();
      await expect(
        f.service.changeRoles('actor', 'target', assign, revoke),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(f.links.delete).not.toHaveBeenCalled();
    },
  );

  it('rejects own ADMIN removal', async () => {
    const f = fixture();
    await expect(
      f.service.changeRoles('target', 'target', [], ['ADMIN']),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('protects last ADMIN in a batch', async () => {
    const f = fixture();
    f.memberships.add('ADMIN');
    f.query.getCount.mockResolvedValue(1);
    await expect(
      f.service.changeRoles('actor', 'target', [], ['ADMIN']),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows ADMIN revocation when another active admin remains', async () => {
    const f = fixture();
    f.memberships.add('ADMIN');
    await f.service.revokeRole('actor', 'target', 'ADMIN');
    expect(f.memberships.has('ADMIN')).toBe(false);
    expect(f.order).toEqual(['global', 'user']);
  });

  it.each(['batch', 'legacy'])(
    'rejects missing membership on %s revocation',
    async (mode) => {
      const f = fixture();
      await expect(
        mode === 'batch'
          ? f.service.changeRoles('actor', 'target', [], ['SELLER'])
          : f.service.revokeRole('actor', 'target', 'SELLER'),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('propagates missing role and rolls back earlier assignment', async () => {
    const f = fixture();
    await expect(
      f.service.changeRoles('actor', 'target', ['SELLER'], ['MISSING']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.rollback).toHaveBeenCalled();
    expect([...f.memberships]).toEqual(['BUYER']);
  });

  it('propagates outbox failure and rolls back role changes', async () => {
    const f = fixture();
    f.outbox.save.mockRejectedValue(new Error('outbox unavailable'));
    await expect(
      f.service.changeRoles('actor', 'target', ['SELLER']),
    ).rejects.toThrow('outbox unavailable');
    expect(f.rollback).toHaveBeenCalled();
    expect([...f.memberships]).toEqual(['BUYER']);
  });

  it('rejects missing mutation targets', async () => {
    const f = fixture();
    f.query.getOne.mockResolvedValue(null);
    await expect(
      f.service.resetPassword('actor', 'missing', 'NewPassword1!'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.users.save).not.toHaveBeenCalled();
  });

  it('hashes with Argon2id and invalidates sessions without recording secrets', async () => {
    const f = fixture();
    const password = 'NewPassword1!';
    await f.service.resetPassword('actor', 'target', password);
    expect(f.user.passwordHash).toContain('$argon2id$');
    expect(await argon2.verify(f.user.passwordHash!, password)).toBe(true);
    expect(f.user.tokenVersion).toBe(3);
    expect(f.sessions.update).toHaveBeenCalled();
    expect(
      JSON.stringify([f.audit.save.mock.calls, f.outbox.save.mock.calls]),
    ).not.toContain(password);
    expect(
      JSON.stringify([f.audit.save.mock.calls, f.outbox.save.mock.calls]),
    ).not.toContain(f.user.passwordHash!);
    await expect(
      f.service.resetPassword('actor', 'target', password),
    ).rejects.toBeInstanceOf(BadRequestException);
    await f.service.resetPassword('actor', 'target', 'OtherPassword2!');
    expect(f.user.tokenVersion).toBe(4);
  });
});
