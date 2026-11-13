import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserEntity } from '../../domain/user.entity.js';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  let service: TokenService;
  let tokenRepo: any;
  let txTokens: any;
  let userQuery: any;
  let jwt: any;
  const user = Object.assign(new UserEntity(), {
    id: 'user-1',
    email: 'user@example.com',
    tokenVersion: 6,
  });

  beforeEach(() => {
    tokenRepo = {
      findOne: vi.fn(),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      update: vi.fn(),
    };
    txTokens = {
      findOne: vi.fn(),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      update: vi.fn(),
    };
    userQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(user),
    };
    const manager = {
      getRepository: vi.fn((entity) =>
        entity === UserEntity
          ? { createQueryBuilder: vi.fn(() => userQuery) }
          : txTokens,
      ),
    };
    jwt = { signAsync: vi.fn().mockResolvedValue('access') };
    service = new TokenService(tokenRepo, jwt, {
      transaction: vi.fn(async (work) => work(manager)),
    } as never);
  });

  it('adds current tokenVersion and uses an 8 hour access expiry', async () => {
    await service.generateAccessToken(user);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: user.id, email: user.email, tokenVersion: 6 },
      { expiresIn: '8h' },
    );
  });

  it('reads JWT_ACCESS_EXPIRES_IN from ConfigService for signing and expiresIn seconds', async () => {
    const configuredService = new TokenService(
      tokenRepo,
      jwt,
      { transaction: vi.fn() } as never,
      new ConfigService({ JWT_ACCESS_EXPIRES_IN: '15m' }),
    );

    await configuredService.generateAccessToken(user);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: user.id, email: user.email, tokenVersion: 6 },
      { expiresIn: '15m' },
    );
    expect(configuredService.getAccessTokenExpiresInSeconds()).toBe(900);
  });

  it('uses a provided transaction repository for refresh creation', async () => {
    await service.createRefreshToken(user.id, {}, txTokens);
    expect(txTokens.save).toHaveBeenCalled();
    expect(tokenRepo.save).not.toHaveBeenCalled();
  });

  it('uses default tokenRepo and generates familyId when not provided', async () => {
    const rawToken = await service.createRefreshToken(user.id, {});
    expect(tokenRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        ipAddress: null,
        userAgent: null,
        familyId: expect.any(String),
      }),
    );
    expect(tokenRepo.save).toHaveBeenCalled();
    expect(typeof rawToken).toBe('string');
  });

  it('locks the active user then rereads and rotates the token atomically', async () => {
    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    txTokens.findOne.mockResolvedValue({
      userId: user.id,
      familyId: 'family',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.rotateRefreshToken('raw', {})).resolves.toMatchObject({
      user,
      newAccessToken: 'access',
    });
    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(userQuery.andWhere).toHaveBeenCalledWith('user.status = :status', {
      status: 'ACTIVE',
    });
    expect(txTokens.save).toHaveBeenCalledTimes(2);
  });

  it('keeps reuse detection and commits family revocation before throwing', async () => {
    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    txTokens.findOne.mockResolvedValue({
      familyId: 'family',
      revokedAt: new Date(),
    });
    await expect(service.rotateRefreshToken('raw', {})).rejects.toThrow(
      'Phát hiện token bị đánh cắp. Vui lòng đăng nhập lại',
    );
    expect(txTokens.update).toHaveBeenCalled();
  });

  it('creates no successor when password change revokes refresh while rotation waits for the user lock', async () => {
    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    txTokens.findOne.mockResolvedValue({
      familyId: 'family',
      revokedAt: new Date(),
    });
    await expect(service.rotateRefreshToken('concurrent', {})).rejects.toThrow(
      'Phát hiện token bị đánh cắp. Vui lòng đăng nhập lại',
    );
    expect(userQuery.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      txTokens.findOne.mock.invocationCallOrder[0],
    );
    expect(txTokens.save).not.toHaveBeenCalled();
  });

  it('rejects unknown, expired, and inactive-user refresh attempts', async () => {
    tokenRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.rotateRefreshToken('missing', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    txTokens.findOne.mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(service.rotateRefreshToken('expired', {})).rejects.toThrow(
      'Refresh Token đã hết hạn',
    );

    userQuery.getOne.mockResolvedValueOnce(null);
    await expect(
      service.rotateRefreshToken('inactive', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects rotation if token is missing inside transaction', async () => {
    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    txTokens.findOne.mockResolvedValue(null);

    await expect(
      service.rotateRefreshToken('missing-in-tx', {}),
    ).rejects.toThrow('Refresh Token không tồn tại');
  });

  it('serializes logout revocation with the same user lock', async () => {
    tokenRepo.findOne.mockResolvedValue({ userId: user.id });
    await service.revokeToken('raw');
    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(txTokens.update).toHaveBeenCalled();
  });

  it('does nothing on revokeToken if token does not exist', async () => {
    tokenRepo.findOne.mockResolvedValue(null);
    await service.revokeToken('non-existing-token');
    expect(txTokens.update).not.toHaveBeenCalled();
  });

  describe('Cookie management helpers', () => {
    let mockResponse: any;

    beforeEach(() => {
      mockResponse = {
        cookie: vi.fn(),
        clearCookie: vi.fn(),
      };
    });

    it('sets refresh token cookie with httpOnly and strict sameSite', () => {
      service.setRefreshTokenCookie(mockResponse, 'my-refresh-token');
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refreshToken',
        'my-refresh-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        }),
      );
    });

    it('clears refresh token cookie with correct options', () => {
      service.clearRefreshTokenCookie(mockResponse);
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
        }),
      );
    });
  });
});
