// src/modules/identity/auth/services/token.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { UserEntity } from '../../domain/user.entity.js';

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly tokenRepo: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async generateAccessToken(user: UserEntity): Promise<string> {
    const payload = { sub: user.id, email: user.email };
    return this.jwtService.signAsync(payload, { expiresIn: '15m' });
  }

  async createRefreshToken(
    userId: string,
    metadata: { ipAddress?: string; userAgent?: string; familyId?: string },
  ): Promise<string> {
    const rawToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const familyId = metadata.familyId || randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 ngày

    const entity = this.tokenRepo.create({
      userId,
      tokenHash,
      familyId,
      expiresAt,
      ipAddress: metadata.ipAddress || null,
      userAgent: metadata.userAgent || null,
    });

    await this.tokenRepo.save(entity);
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
    const foundToken = await this.tokenRepo.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!foundToken) {
      throw new UnauthorizedException('Refresh Token không tồn tại');
    }

    // Reuse Detection: Token đã bị thu hồi trước đó nhưng lại được dùng lại
    if (foundToken.revokedAt) {
      // HỦY TOÀN BỘ TOKEN CÙNG FAMILY_ID NGAY LẬP TỨC
      await this.tokenRepo.update(
        { familyId: foundToken.familyId },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException(
        'Phát hiện token bị đánh cắp. Vui lòng đăng nhập lại',
      );
    }

    // Hết hạn thông thường
    if (new Date() > foundToken.expiresAt) {
      throw new UnauthorizedException('Refresh Token đã hết hạn');
    }

    // Thu hồi token hiện tại
    foundToken.revokedAt = new Date();
    await this.tokenRepo.save(foundToken);

    // Kế thừa family_id và cấp token mới
    const newRawRefreshToken = await this.createRefreshToken(
      foundToken.userId,
      {
        ...metadata,
        familyId: foundToken.familyId,
      },
    );

    const newAccessToken = await this.generateAccessToken(foundToken.user);

    return {
      user: foundToken.user,
      newRawRefreshToken,
      newAccessToken,
    };
  }

  async revokeToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.tokenRepo.update({ tokenHash }, { revokedAt: new Date() });
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
