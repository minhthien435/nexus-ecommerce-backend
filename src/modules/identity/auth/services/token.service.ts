// src/modules/identity/auth/services/token.service.ts
import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { UserEntity } from '../../domain/user.entity.js';
import { resolveJwtAccessExpiry } from '../jwt-expiry.util.js';

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly tokenRepo: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  getAccessTokenExpiresInSeconds(): number {
    return resolveJwtAccessExpiry(this.configService).seconds;
  }

  async generateAccessToken(user: UserEntity): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    };
    const { signOption } = resolveJwtAccessExpiry(this.configService);
    return this.jwtService.signAsync(payload, { expiresIn: signOption });
  }

  async createRefreshToken(
    userId: string,
    metadata: { ipAddress?: string; userAgent?: string; familyId?: string },
    tokens: Repository<RefreshTokenEntity> = this.tokenRepo,
  ): Promise<string> {
    const rawToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const familyId = metadata.familyId || randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 ngày

    const entity = tokens.create({
      userId,
      tokenHash,
      familyId,
      expiresAt,
      ipAddress: metadata.ipAddress || null,
      userAgent: metadata.userAgent || null,
    });

    await tokens.save(entity);
    return rawToken;
  }

  async rotateRefreshToken(
    rawToken: string,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    user: UserEntity;
    newRawRefreshToken: string;
    newAccessToken: string;
  }> {
    const tokenHash = this.hashToken(rawToken);
    const tokenIdentity = await this.tokenRepo.findOne({
      where: { tokenHash },
      select: { id: true, userId: true },
    });

    if (!tokenIdentity) {
      throw new UnauthorizedException('Refresh Token không tồn tại');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId: tokenIdentity.userId })
        .andWhere('user.deleted_at IS NULL')
        .andWhere('user.status = :status', { status: 'ACTIVE' })
        .getOne();
      if (!user) throw new UnauthorizedException();
      const tokens = manager.getRepository(RefreshTokenEntity);
      const foundToken = await tokens.findOne({ where: { tokenHash } });
      if (!foundToken)
        throw new UnauthorizedException('Refresh Token không tồn tại');
      if (foundToken.revokedAt) {
        await tokens.update(
          { familyId: foundToken.familyId, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
        return { reused: true as const };
      }
      if (new Date() > foundToken.expiresAt) {
        throw new UnauthorizedException('Refresh Token đã hết hạn');
      }
      foundToken.revokedAt = new Date();
      await tokens.save(foundToken);
      const newRawRefreshToken = await this.createRefreshToken(
        foundToken.userId,
        { ...metadata, familyId: foundToken.familyId },
        tokens,
      );
      return {
        reused: false as const,
        user,
        newRawRefreshToken,
        newAccessToken: await this.generateAccessToken(user),
      };
    });
    if (result.reused) {
      throw new UnauthorizedException(
        'Phát hiện token bị đánh cắp. Vui lòng đăng nhập lại',
      );
    }
    return result;
  }

  async revokeToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const tokenIdentity = await this.tokenRepo.findOne({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!tokenIdentity) return;
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId: tokenIdentity.userId })
        .getOne();
      await manager
        .getRepository(RefreshTokenEntity)
        .update({ tokenHash }, { revokedAt: new Date() });
    });
  }

  setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
  }
}
