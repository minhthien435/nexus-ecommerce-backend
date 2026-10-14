import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { PasswordService } from './password.service.js';

vi.mock('argon2', () => ({
  argon2id: 2,
  verify: vi.fn(
    async (hash: string, password: string) => hash === `hash:${password}`,
  ),
  hash: vi.fn(async (password: string) => `hash:${password}`),
}));

type State = {
  user: {
    id: string;
    passwordHash: string | null;
    tokenVersion: number;
  } | null;
  tokens: Array<{ userId: string; revokedAt: Date | null }>;
};

const clone = (state: State): State => ({
  user: state.user ? { ...state.user } : null,
  tokens: state.tokens.map((token) => ({ ...token })),
});

function statefulDataSource(initial: State) {
  let committed = clone(initial);
  let tail = Promise.resolve();
  let releaseTail: () => void = () => {};
  let failTokenUpdate = false;
  let pauseFirstRead = false;
  let firstReadSeen!: () => void;
  let releaseFirstRead!: () => void;
  const firstRead = new Promise<void>((resolve) => (firstReadSeen = resolve));
  const firstReadGate = new Promise<void>(
    (resolve) => (releaseFirstRead = resolve),
  );
  let transactionRequests = 0;
  let lockHolders = 0;
  let maxLockHolders = 0;

  const dataSource = {
    transaction: vi.fn(async (work: (manager: any) => Promise<unknown>) => {
      transactionRequests += 1;
      const predecessor = tail;
      tail = new Promise<void>((resolve) => (releaseTail = resolve));
      await predecessor;
      lockHolders += 1;
      maxLockHolders = Math.max(maxLockHolders, lockHolders);
      const release = releaseTail;
      const draft = clone(committed);
      const query = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn(async () => {
          if (pauseFirstRead) {
            pauseFirstRead = false;
            firstReadSeen();
            await firstReadGate;
          }
          return draft.user
            ? Object.assign(new UserEntity(), draft.user)
            : null;
        }),
      };
      const users = {
        createQueryBuilder: vi.fn(() => query),
        save: vi.fn(async (user: UserEntity) => {
          draft.user = {
            id: user.id,
            passwordHash: user.passwordHash,
            tokenVersion: user.tokenVersion,
          };
          return user;
        }),
      };
      const tokens = {
        update: vi.fn(async () => {
          for (const token of draft.tokens) token.revokedAt = new Date();
          if (failTokenUpdate) throw new Error('database failure');
        }),
      };
      try {
        const result = await work({
          getRepository: (entity: unknown) =>
            entity === UserEntity ? users : tokens,
        });
        committed = draft;
        return result;
      } finally {
        lockHolders -= 1;
        release();
      }
    }),
  };

  return {
    dataSource,
    state: () => clone(committed),
    failNextTokenUpdate: () => (failTokenUpdate = true),
    pauseNextRead: () => (pauseFirstRead = true),
    firstRead,
    releaseFirstRead,
    transactionRequests: () => transactionRequests,
    maxLockHolders: () => maxLockHolders,
  };
}

describe('PasswordService', () => {
  const initial: State = {
    user: { id: 'user-1', passwordHash: 'hash:OldPassword1!', tokenVersion: 4 },
    tokens: [
      { userId: 'user-1', revokedAt: null },
      { userId: 'user-1', revokedAt: null },
    ],
  };

  beforeEach(() => vi.clearAllMocks());

  it('atomically commits hash, version, and refresh revocation', async () => {
    const fake = statefulDataSource(initial);
    await new PasswordService(fake.dataSource as never).changePassword(
      'user-1',
      {
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword2!',
      },
    );
    expect(fake.state()).toEqual({
      user: {
        id: 'user-1',
        passwordHash: 'hash:NewPassword2!',
        tokenVersion: 5,
      },
      tokens: [
        { userId: 'user-1', revokedAt: expect.any(Date) },
        { userId: 'user-1', revokedAt: expect.any(Date) },
      ],
    });
    expect(argon2.hash).toHaveBeenCalledWith(
      'NewPassword2!',
      expect.objectContaining({ type: argon2.argon2id }),
    );
  });

  it('restores committed state when a later transaction write fails', async () => {
    const fake = statefulDataSource(initial);
    fake.failNextTokenUpdate();
    await expect(
      new PasswordService(fake.dataSource as never).changePassword('user-1', {
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword2!',
      }),
    ).rejects.toThrow('database failure');
    expect(fake.state()).toEqual(initial);
  });

  it('serializes two genuinely overlapping requests so only one old password succeeds', async () => {
    const fake = statefulDataSource(initial);
    fake.pauseNextRead();
    const service = new PasswordService(fake.dataSource as never);
    const input = {
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2!',
    };

    const first = service.changePassword('user-1', input);
    await fake.firstRead;
    const second = service.changePassword('user-1', input);
    await Promise.resolve();
    expect(fake.transactionRequests()).toBe(2);
    expect(fake.maxLockHolders()).toBe(1);
    fake.releaseFirstRead();

    const results = await Promise.allSettled([first, second]);
    expect(results.map(({ status }) => status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(results[1].status === 'rejected' && results[1].reason.message).toBe(
      'Current password is incorrect',
    );
    expect(fake.state().user?.tokenVersion).toBe(5);
  });

  it('throws BadRequestException when user does not exist or is inactive', async () => {
    const fake = statefulDataSource({ user: null, tokens: [] });
    await expect(
      new PasswordService(fake.dataSource as never).changePassword('user-99', {
        currentPassword: 'OldPassword1!',
        newPassword: 'NewPassword2!',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException with exact message when new password is identical to current password', async () => {
    const fake = statefulDataSource(initial);
    await expect(
      new PasswordService(fake.dataSource as never).changePassword('user-1', {
        currentPassword: 'OldPassword1!',
        newPassword: 'OldPassword1!',
      }),
    ).rejects.toThrow('New password must be different from current password');
  });

  it('does not write on incorrect current password', async () => {
    const fake = statefulDataSource(initial);
    await expect(
      new PasswordService(fake.dataSource as never).changePassword('user-1', {
        currentPassword: 'WrongPassword1!',
        newPassword: 'NewPassword2!',
      }),
    ).rejects.toThrow('Current password is incorrect');
    expect(fake.state()).toEqual(initial);
  });
});
