import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenService } from './token.service.js';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { UserEntity } from '../../domain/user.entity.js';

describe('TokenService (Token Family & Reuse Detection)', () => {
  let tokenService: TokenService;
  let tokenRepo: any;
  let jwtService: any;

  beforeEach(() => {
    tokenRepo = {
      create: vi.fn((data) => ({ id: 'token-uuid', ...data })),
      save: vi.fn((token) => Promise.resolve(token)),
      findOne: vi.fn(),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    jwtService = {
      signAsync: vi.fn().mockResolvedValue('jwt-access-token-15m'),
    };

    tokenService = new TokenService(tokenRepo, jwtService);
  });

  describe('createRefreshToken', () => {
    it('tạo refresh token mới với family_id và hạn 7 ngày', async () => {
      const rawToken = await tokenService.createRefreshToken('user-1', {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla',
      });

      expect(typeof rawToken).toBe('string');
      expect(tokenRepo.create).toHaveBeenCalled();
      expect(tokenRepo.save).toHaveBeenCalled();
    });
  });

  describe('rotateRefreshToken (Rotation & Reuse Detection)', () => {
    it('báo UnauthorizedException nếu token không tồn tại', async () => {
      tokenRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        tokenService.rotateRefreshToken('non-existent-token', {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('PHÁT HIỆN REUSE DETECTION: thu hồi toàn bộ family_id khi token đã bị revoke bị dùng lại', async () => {
      const reusedToken = new RefreshTokenEntity();
      reusedToken.familyId = 'family-uuid-123';
      reusedToken.revokedAt = new Date(Date.now() - 3600000); // Đã bị thu hồi 1 tiếng trước

      tokenRepo.findOne.mockResolvedValueOnce(reusedToken);

      await expect(
        tokenService.rotateRefreshToken('stolen-reused-token', {}),
      ).rejects.toThrow('Phát hiện token bị đánh cắp. Vui lòng đăng nhập lại');

      // Phải gọi update thu hồi toàn bộ token cùng family_id
      expect(tokenRepo.update).toHaveBeenCalledWith(
        { familyId: 'family-uuid-123' },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('báo UnauthorizedException nếu token đã quá hạn 7 ngày', async () => {
      const expiredToken = new RefreshTokenEntity();
      expiredToken.revokedAt = null;
      expiredToken.expiresAt = new Date(Date.now() - 1000); // Hết hạn

      tokenRepo.findOne.mockResolvedValueOnce(expiredToken);

      await expect(
        tokenService.rotateRefreshToken('expired-token', {}),
      ).rejects.toThrow('Refresh Token đã hết hạn');
    });

    it('xoay vòng hợp lệ: thu hồi token cũ, cấp token mới cùng family_id', async () => {
      const user = new UserEntity();
      user.id = 'user-1';
      user.email = 'test@example.com';

      const validToken = new RefreshTokenEntity();
      validToken.userId = 'user-1';
      validToken.familyId = 'family-uuid-123';
      validToken.revokedAt = null;
      validToken.expiresAt = new Date(Date.now() + 6 * 24 * 3600000);
      validToken.user = user;

      tokenRepo.findOne.mockResolvedValueOnce(validToken);

      const result = await tokenService.rotateRefreshToken('valid-raw-token', {
        ipAddress: '127.0.0.1',
      });

      expect(validToken.revokedAt).toBeInstanceOf(Date);
      expect(result.newAccessToken).toBe('jwt-access-token-15m');
      expect(typeof result.newRawRefreshToken).toBe('string');
      expect(result.user).toBe(user);
    });
  });
});
