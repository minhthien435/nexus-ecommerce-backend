import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import { UserEntity } from '../../domain/user.entity.js';

describe('AuthService', () => {
  let authService: AuthService;
  let userRepo: any;
  let tokenService: any;

  beforeEach(() => {
    userRepo = {
      findOne: vi.fn(),
      create: vi.fn((data) => ({ id: 'mock-uuid', ...data })),
      save: vi.fn((user) => Promise.resolve(user)),
    };

    tokenService = {
      generateAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
      createRefreshToken: vi.fn().mockResolvedValue('mock-raw-refresh-token'),
    };

    authService = new AuthService(userRepo, tokenService);
  });

  describe('register', () => {
    it('báo lỗi ConflictException nếu email đã tồn tại', async () => {
      userRepo.findOne.mockResolvedValueOnce(new UserEntity());

      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'Password123!',
          fullName: 'Nguyễn Văn A',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('đăng ký thành công và không để lộ passwordHash', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      const result = await authService.register({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Nguyễn Văn A',
        phone: '0912345678',
      });

      expect(result.email).toBe('test@example.com');
      expect(result.fullName).toBe('Nguyễn Văn A');
      expect((result as any).passwordHash).toBeUndefined();
      expect(userRepo.save).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('báo lỗi UnauthorizedException nếu email không tồn tại', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        authService.login(
          { email: 'unknown@example.com', password: 'Password123!' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('báo lỗi ForbiddenException nếu tài khoản đang bị khóa (locked_until > now)', async () => {
      const lockedUser = new UserEntity();
      lockedUser.email = 'locked@example.com';
      lockedUser.lockedUntil = new Date(Date.now() + 10 * 60000); // Còn 10 phút

      userRepo.findOne.mockResolvedValueOnce(lockedUser);

      await expect(
        authService.login(
          { email: 'locked@example.com', password: 'Password123!' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('tăng số lần đăng nhập sai và báo UnauthorizedException khi sai mật khẩu', async () => {
      const user = new UserEntity();
      user.email = 'test@example.com';
      user.passwordHash = await argon2.hash('CorrectPassword123!');
      user.failedLoginAttempts = 1;
      user.lockedUntil = null;

      userRepo.findOne.mockResolvedValueOnce(user);

      await expect(
        authService.login(
          { email: 'test@example.com', password: 'WrongPassword!' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(user.failedLoginAttempts).toBe(2);
      expect(userRepo.save).toHaveBeenCalledWith(user);
    });

    it('tự động khóa tài khoản 15 phút khi nhập sai liên tiếp 5 lần', async () => {
      const user = new UserEntity();
      user.email = 'test@example.com';
      user.passwordHash = await argon2.hash('CorrectPassword123!');
      user.failedLoginAttempts = 4; // Lần sai thứ 5 kế tiếp
      user.lockedUntil = null;

      userRepo.findOne.mockResolvedValueOnce(user);

      await expect(
        authService.login(
          { email: 'test@example.com', password: 'WrongPassword!' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeInstanceOf(Date);
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('đăng nhập thành công: reset lockout và trả về tokens', async () => {
      const user = new UserEntity();
      user.id = 'user-uuid-1';
      user.email = 'test@example.com';
      user.fullName = 'Nguyễn Văn A';
      user.passwordHash = await argon2.hash('Password123!');
      user.failedLoginAttempts = 3;
      user.lockedUntil = null;

      userRepo.findOne.mockResolvedValueOnce(user);

      const result = await authService.login(
        { email: 'test@example.com', password: 'Password123!' },
        { ipAddress: '127.0.0.1' },
      );

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.rawRefreshToken).toBe('mock-raw-refresh-token');
      expect(result.user.email).toBe('test@example.com');
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lastLoginAt).toBeInstanceOf(Date);
    });
  });
});
