import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { PasswordResetTokenEntity } from '../../domain/password-reset-token.entity.js';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { PasswordResetService } from './password-reset.service.js';

describe('PasswordResetService (BMAD TDD)', () => {
  let service: PasswordResetService;
  let userRepo: {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let resetTokenRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let refreshTokenRepo: { update: ReturnType<typeof vi.fn> };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepo = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation((u) => Promise.resolve(u)),
    };
    resetTokenRepo = {
      create: vi.fn().mockImplementation((d) => ({ id: 'token-uuid', ...d })),
      save: vi.fn().mockImplementation((t) => Promise.resolve(t)),
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    refreshTokenRepo = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: vi.fn(async (cb) => {
        const manager = {
          getRepository: (entity: unknown) => {
            if (entity === UserEntity) return userRepo;
            if (entity === PasswordResetTokenEntity) return resetTokenRepo;
            if (entity === RefreshTokenEntity) return refreshTokenRepo;
            return null;
          },
        };
        return cb(manager);
      }),
    };

    service = new PasswordResetService(
      userRepo as never,
      resetTokenRepo as never,
      refreshTokenRepo as never,
      dataSource as never,
    );
  });

  describe('forgotPassword', () => {
    it('generates 6-digit OTP, stores hashed token with 15m TTL and returns result', async () => {
      const existingUser = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'test@nexus.vn',
        status: 'ACTIVE',
        deletedAt: null,
      });
      userRepo.findOne.mockResolvedValue(existingUser);

      const result = await service.forgotPassword({ email: 'test@nexus.vn' });

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: {
          email: 'test@nexus.vn',
          status: 'ACTIVE',
          deletedAt: expect.anything(),
        },
      });
      expect(resetTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(resetTokenRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({
        email: 'test@nexus.vn',
        expiresIn: 900,
        devOtp: expect.stringMatching(/^\d{6}$/),
      });
    });

    it('throws NotFoundException when email is not found in database', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'unknown@nexus.vn' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('verifyResetOtp', () => {
    it('verifies correct OTP, marks it used, and returns a secure resetToken', async () => {
      const user = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'test@nexus.vn',
      });
      userRepo.findOne.mockResolvedValue(user);

      const otp = '123456';
      const otpHash = crypto
        .createHash('sha256')
        .update(`OTP:user-1:${otp}`)
        .digest('hex');
      const resetRecord = Object.assign(new PasswordResetTokenEntity(), {
        id: 'otp-record-1',
        userId: 'user-1',
        tokenHash: otpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      });
      resetTokenRepo.findOne.mockResolvedValue(resetRecord);

      const result = await service.verifyResetOtp({
        email: 'test@nexus.vn',
        otp: '123456',
      });

      expect(resetRecord.usedAt).toBeInstanceOf(Date);
      expect(result).toHaveProperty('resetToken');
      expect(typeof result.resetToken).toBe('string');
      expect(result.resetToken.length).toBeGreaterThan(20);
    });

    it('rejects incorrect OTP with BadRequestException', async () => {
      const user = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'test@nexus.vn',
      });
      userRepo.findOne.mockResolvedValue(user);
      resetTokenRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyResetOtp({ email: 'test@nexus.vn', otp: '999999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects expired OTP with UnprocessableEntityException', async () => {
      const user = Object.assign(new UserEntity(), {
        id: 'user-1',
        email: 'test@nexus.vn',
      });
      userRepo.findOne.mockResolvedValue(user);

      const expiredRecord = Object.assign(new PasswordResetTokenEntity(), {
        id: 'otp-expired',
        userId: 'user-1',
        tokenHash: 'some-hash',
        expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago
        usedAt: null,
      });
      resetTokenRepo.findOne.mockResolvedValue(expiredRecord);

      await expect(
        service.verifyResetOtp({ email: 'test@nexus.vn', otp: '123456' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('resetPassword', () => {
    it('successfully resets password, updates tokenVersion, revokes all refresh tokens and marks token used', async () => {
      const rawResetToken = 'valid-reset-token-sample';
      const tokenHash = crypto
        .createHash('sha256')
        .update(`RESET_TOKEN:${rawResetToken}`)
        .digest('hex');
      const resetRecord = Object.assign(new PasswordResetTokenEntity(), {
        id: 'token-rec-1',
        userId: 'user-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      });
      resetTokenRepo.findOne.mockResolvedValue(resetRecord);

      const currentPasswordHash = await argon2.hash('OldPassword1!', {
        type: argon2.argon2id,
      });
      const user = Object.assign(new UserEntity(), {
        id: 'user-1',
        passwordHash: currentPasswordHash,
        tokenVersion: 2,
        failedLoginAttempts: 3,
        lockedUntil: new Date(),
      });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.resetPassword({
        resetToken: rawResetToken,
        newPassword: 'BrandNewPassword123@',
      });

      expect(result).toBeNull();
      expect(user.passwordHash).not.toBe(currentPasswordHash);
      expect(user.tokenVersion).toBe(3);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
      expect(resetRecord.usedAt).toBeInstanceOf(Date);
      expect(refreshTokenRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1', revokedAt: expect.anything() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('rejects if new password is identical to current password', async () => {
      const rawResetToken = 'valid-reset-token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(`RESET_TOKEN:${rawResetToken}`)
        .digest('hex');
      const resetRecord = Object.assign(new PasswordResetTokenEntity(), {
        id: 'token-rec-2',
        userId: 'user-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      });
      resetTokenRepo.findOne.mockResolvedValue(resetRecord);

      const passwordHash = await argon2.hash('SamePassword1@', {
        type: argon2.argon2id,
      });
      const user = Object.assign(new UserEntity(), {
        id: 'user-1',
        passwordHash,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.resetPassword({
          resetToken: rawResetToken,
          newPassword: 'SamePassword1@',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows Google user with null passwordHash to set password for the first time', async () => {
      const rawResetToken = 'google-user-reset-token';
      const tokenHash = crypto
        .createHash('sha256')
        .update(`RESET_TOKEN:${rawResetToken}`)
        .digest('hex');
      const resetRecord = Object.assign(new PasswordResetTokenEntity(), {
        id: 'token-rec-google',
        userId: 'google-user',
        tokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      });
      resetTokenRepo.findOne.mockResolvedValue(resetRecord);

      const user = Object.assign(new UserEntity(), {
        id: 'google-user',
        passwordHash: null, // Google user initially has no password
        tokenVersion: 0,
      });
      userRepo.findOne.mockResolvedValue(user);

      await service.resetPassword({
        resetToken: rawResetToken,
        newPassword: 'FirstPassword123!',
      });

      expect(user.passwordHash).toBeTruthy();
      expect(user.tokenVersion).toBe(1);
    });
  });
});
