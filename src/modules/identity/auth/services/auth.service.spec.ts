import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let userRepo: any;
  let users: any;
  let query: any;
  let tokenService: any;
  let refreshTokens: any;
  let manager: any;
  let service: AuthService;

  beforeEach(() => {
    userRepo = {
      findOne: vi.fn(),
      create: vi.fn((value) => ({ id: 'new-user', tokenVersion: 0, ...value })),
      save: vi.fn(async (value) => value),
    };
    query = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn(),
    };
    users = {
      createQueryBuilder: vi.fn(() => query),
      create: vi.fn((value) => ({ id: 'new-user', tokenVersion: 0, ...value })),
      save: vi.fn(async (value) => value),
    };
    refreshTokens = {};
    manager = {
      getRepository: vi.fn((entity) =>
        entity === UserEntity ? users : refreshTokens,
      ),
      query: vi.fn().mockResolvedValue([{ role_id: 'buyer-role' }]),
    };
    tokenService = {
      generateAccessToken: vi.fn().mockResolvedValue('access'),
      createRefreshToken: vi.fn().mockResolvedValue('refresh'),
    };
    service = new AuthService(userRepo, tokenService, {
      transaction: vi.fn(async (work) => work(manager)),
    } as never);
  });

  it('preserves registration behavior and omits passwordHash', async () => {
    userRepo.findOne.mockResolvedValue(null);
    const result = await service.register({
      email: 'user@example.com',
      password: 'Password1!',
      fullName: 'User',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("code = 'BUYER'"),
      ['new-user'],
    );
    userRepo.findOne.mockResolvedValue(new UserEntity());
    await expect(
      service.register({
        email: 'user@example.com',
        password: 'Password1!',
        fullName: 'User',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks and filters ACTIVE users before credential validation and token issuance', async () => {
    const user = Object.assign(new UserEntity(), {
      id: 'user-1',
      email: 'user@example.com',
      fullName: 'User',
      passwordHash: await argon2.hash('NewPassword2!'),
      tokenVersion: 8,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    query.getOne.mockResolvedValue(user);
    await expect(
      service.login(
        { email: user.email, password: 'NewPassword2!' },
        { ipAddress: '127.0.0.1' },
      ),
    ).resolves.toMatchObject({
      accessToken: 'access',
      rawRefreshToken: 'refresh',
    });
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(query.andWhere).toHaveBeenCalledWith('user.status = :status', {
      status: 'ACTIVE',
    });
    expect(tokenService.generateAccessToken).toHaveBeenCalledWith(user);
    expect(tokenService.createRefreshToken).toHaveBeenCalledWith(
      user.id,
      { ipAddress: '127.0.0.1' },
      refreshTokens,
    );
  });

  it('treats non-active/missing locked-query results as unauthorized without issuing tokens', async () => {
    query.getOne.mockResolvedValue(null);
    await expect(
      service.login(
        { email: 'suspended@example.com', password: 'Password1!' },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
  });

  it('revalidates the password from the locked row and cannot issue an old session', async () => {
    query.getOne.mockResolvedValue(
      Object.assign(new UserEntity(), {
        passwordHash: await argon2.hash('NewPassword2!'),
        failedLoginAttempts: 0,
        lockedUntil: null,
      }),
    );
    await expect(
      service.login(
        { email: 'user@example.com', password: 'OldPassword1!' },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
  });
});
