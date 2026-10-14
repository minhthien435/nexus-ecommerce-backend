import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { AuthService } from './auth.service.js';

vi.mock('argon2', () => ({
  argon2id: 2,
  verify: vi.fn(
    async (hash: string, password: string) => hash === `hash:${password}`,
  ),
  hash: vi.fn(async (password: string) => `hash:${password}`),
}));

describe('AuthService', () => {
  let userRepo: any;
  let users: any;
  let query: any;
  let tokenService: any;
  let refreshTokens: any;
  let manager: any;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();

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
      findOne: vi.fn(),
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
      generateAccessToken: vi.fn().mockResolvedValue('access-token'),
      createRefreshToken: vi.fn().mockResolvedValue('refresh-token'),
    };

    service = new AuthService(userRepo, tokenService, {
      transaction: vi.fn(async (work) => work(manager)),
    } as never);
  });

  describe('register', () => {
    it('registers user successfully with phone and omits passwordHash from response', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const dto = {
        email: 'newuser@example.com',
        password: 'Password1!',
        fullName: 'New User',
        phone: '0912345678',
      };

      const result = await service.register(dto);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: [{ email: dto.email }, { phone: dto.phone }],
      });
      expect(argon2.hash).toHaveBeenCalledWith(
        'Password1!',
        expect.objectContaining({ type: 2 }),
      );
      expect(users.create).toHaveBeenCalledWith({
        email: dto.email,
        phone: dto.phone,
        passwordHash: 'hash:Password1!',
        fullName: dto.fullName,
        status: 'ACTIVE',
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toEqual(
        expect.objectContaining({
          id: 'new-user',
          email: dto.email,
          fullName: dto.fullName,
          phone: dto.phone,
        }),
      );
    });

    it('registers user successfully without phone (phone is null)', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const dto = {
        email: 'nophone@example.com',
        password: 'Password1!',
        fullName: 'No Phone User',
      };

      const result = await service.register(dto);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: [{ email: dto.email }],
      });
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: null,
        }),
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws ConflictException if email or phone already exists', async () => {
      userRepo.findOne.mockResolvedValue(new UserEntity());
      const dto = {
        email: 'existing@example.com',
        password: 'Password1!',
        fullName: 'Existing User',
      };

      await expect(service.register(dto)).rejects.toThrow(
        new ConflictException('Email hoặc số điện thoại đã được đăng ký'),
      );
    });
  });

  describe('login', () => {
    it('logs in successfully with valid credentials and resets failed attempts', async () => {
      const activeUser = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'user@example.com',
        fullName: 'Active User',
        passwordHash: 'hash:CorrectPassword1!',
        failedLoginAttempts: 3,
        lockedUntil: null,
      });
      query.getOne.mockResolvedValue(activeUser);

      const metadata = { ipAddress: '127.0.0.1', userAgent: 'test-agent' };
      const result = await service.login(
        { email: 'user@example.com', password: 'CorrectPassword1!' },
        metadata,
      );

      expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(query.where).toHaveBeenCalledWith('user.email = :email', {
        email: 'user@example.com',
      });
      expect(query.andWhere).toHaveBeenCalledWith('user.deleted_at IS NULL');
      expect(query.andWhere).toHaveBeenCalledWith('user.status = :status', {
        status: 'ACTIVE',
      });
      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date),
        }),
      );
      expect(tokenService.generateAccessToken).toHaveBeenCalledWith(activeUser);
      expect(tokenService.createRefreshToken).toHaveBeenCalledWith(
        'user-1',
        metadata,
        refreshTokens,
      );
      expect(result).not.toHaveProperty('unauthorized');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result).toEqual({
        user: expect.objectContaining({
          id: 'user-1',
          email: 'user@example.com',
        }),
        accessToken: 'access-token',
        rawRefreshToken: 'refresh-token',
      });
    });

    it('throws UnauthorizedException when user is not found or inactive', async () => {
      query.getOne.mockResolvedValue(null);

      await expect(
        service.login(
          { email: 'nonexistent@example.com', password: 'Password1!' },
          {},
        ),
      ).rejects.toThrow(
        new UnauthorizedException('Email hoặc mật khẩu không chính xác'),
      );
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
      expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when account is currently locked', async () => {
      const futureTime = new Date(Date.now() + 10 * 60 * 1000);
      const lockedUser = Object.assign(new UserEntity(), {
        id: 'user-locked',
        email: 'locked@example.com',
        passwordHash: 'hash:Password1!',
        lockedUntil: futureTime,
      });
      query.getOne.mockResolvedValue(lockedUser);

      await expect(
        service.login(
          { email: 'locked@example.com', password: 'Password1!' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.login(
          { email: 'locked@example.com', password: 'Password1!' },
          {},
        ),
      ).rejects.toThrow(/Tài khoản đang tạm khóa do nhập sai nhiều lần/);
    });

    it('increments failedLoginAttempts on incorrect password (attempts 1 to 4)', async () => {
      const activeUser = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hash:CorrectPassword1!',
        failedLoginAttempts: 2,
        lockedUntil: null,
      });
      query.getOne.mockResolvedValue(activeUser);

      await expect(
        service.login(
          { email: 'user@example.com', password: 'WrongPassword!' },
          {},
        ),
      ).rejects.toThrow(
        new UnauthorizedException('Email hoặc mật khẩu không chính xác'),
      );

      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 3,
        }),
      );
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    });

    it('locks account for 15 minutes on the 5th failed login attempt', async () => {
      const activeUser = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'user@example.com',
        passwordHash: 'hash:CorrectPassword1!',
        failedLoginAttempts: 4,
        lockedUntil: null,
      });
      query.getOne.mockResolvedValue(activeUser);

      const beforeTime = Date.now();
      await expect(
        service.login(
          { email: 'user@example.com', password: 'WrongPassword!' },
          {},
        ),
      ).rejects.toThrow(
        new UnauthorizedException('Email hoặc mật khẩu không chính xác'),
      );

      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: expect.any(Date),
        }),
      );

      const savedUser = users.save.mock.calls[0][0];
      const lockedTime = savedUser.lockedUntil.getTime();
      expect(lockedTime).toBeGreaterThanOrEqual(beforeTime + 14 * 60 * 1000);
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('loginWithGoogle', () => {
    const identity = {
      subject: 'google-sub',
      email: 'user@example.com',
      fullName: 'Google User',
    };

    it('creates an ACTIVE passwordless BUYER and issues tokens', async () => {
      users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await service.loginWithGoogle(identity, {
        ipAddress: '127.0.0.1',
      });

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: identity.email,
          googleSub: identity.subject,
          passwordHash: null,
          status: 'ACTIVE',
        }),
      );
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("code = 'BUYER'"),
        ['new-user'],
      );
      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'access-token',
          rawRefreshToken: 'refresh-token',
        }),
      );
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('links an existing eligible account by verified email', async () => {
      const existing = Object.assign(new UserEntity(), {
        id: 'existing-user',
        email: identity.email,
        passwordHash: 'hash:Password1!',
        googleSub: null,
        status: 'ACTIVE',
        deletedAt: null,
      });
      users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

      await service.loginWithGoogle(identity, {});

      expect(existing.googleSub).toBe(identity.subject);
      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({ googleSub: identity.subject }),
      );
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('resolves an existing mixed-case email case-insensitively', async () => {
      const existing = Object.assign(new UserEntity(), {
        id: 'existing-user',
        email: 'User@Example.com',
        passwordHash: 'hash:Password1!',
        googleSub: null,
        status: 'ACTIVE',
        deletedAt: null,
      });
      users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

      await service.loginWithGoogle(identity, {});

      expect(users.findOne).toHaveBeenNthCalledWith(2, {
        where: {
          email: expect.objectContaining({
            _type: 'ilike',
            _value: 'user@example.com',
          }),
        },
        withDeleted: true,
      });
      expect(existing.googleSub).toBe(identity.subject);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('rejects conflicting identities without issuing tokens', async () => {
      const bySubject = Object.assign(new UserEntity(), {
        id: 'one',
        status: 'ACTIVE',
      });
      const byEmail = Object.assign(new UserEntity(), {
        id: 'two',
        status: 'ACTIVE',
      });
      users.findOne
        .mockResolvedValueOnce(bySubject)
        .mockResolvedValueOnce(byEmail);

      await expect(service.loginWithGoogle(identity, {})).rejects.toThrow(
        ConflictException,
      );
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
      expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
    });

    it('rejects inactive accounts without issuing tokens', async () => {
      const inactive = Object.assign(new UserEntity(), {
        id: 'inactive',
        email: identity.email,
        googleSub: identity.subject,
        status: 'SUSPENDED',
        deletedAt: null,
      });
      users.findOne
        .mockResolvedValueOnce(inactive)
        .mockResolvedValueOnce(inactive);

      await expect(service.loginWithGoogle(identity, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    });

    it('rejects deleted Google-linked accounts without issuing tokens', async () => {
      const deleted = Object.assign(new UserEntity(), {
        id: 'deleted',
        email: identity.email,
        googleSub: identity.subject,
        status: 'ACTIVE',
        deletedAt: new Date(),
      });
      users.findOne
        .mockResolvedValueOnce(deleted)
        .mockResolvedValueOnce(deleted);

      await expect(service.loginWithGoogle(identity, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
      expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
    });
  });
});
