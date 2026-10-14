import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import * as argon2 from 'argon2';
import { DataSource, IsNull, Repository } from 'typeorm';
import { PasswordResetTokenEntity } from '../../domain/password-reset-token.entity.js';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { UserEntity } from '../../domain/user.entity.js';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto.js';
import { VerifyResetOtpDto } from '../dtos/verify-reset-otp.dto.js';
import { ResetPasswordDto } from '../dtos/reset-password.dto.js';
import { EmailService } from '../../../../common/email/email.service.js';

const OTP_TTL_SECONDS = 900; // 15 phút
const RESET_TOKEN_TTL_SECONDS = 900; // 15 phút

export type ForgotPasswordResult = {
  message: string;
  expiresIn: number;
};

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PasswordResetTokenEntity)
    private readonly resetTokenRepo: Repository<PasswordResetTokenEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepo: Repository<RefreshTokenEntity>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  async forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResult> {
    const user = await this.userRepo.findOne({
      where: {
        email: dto.email.trim().toLowerCase(),
        status: 'ACTIVE',
        deletedAt: IsNull(),
      },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: 'RESOURCE_NOT_FOUND',
        message: 'Email không tồn tại trong hệ thống',
      });
    }

    const otp = crypto.randomInt(100000, 1_000_000).toString();
    const tokenHash = this.hashOtp(user.id, otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Invalidate any existing unused OTPs
    await this.resetTokenRepo.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const tokenRecord = this.resetTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });
    await this.resetTokenRepo.save(tokenRecord);

    try {
      await this.emailService.sendPasswordResetOtp(
        user.email,
        otp,
        OTP_TTL_SECONDS / 60,
      );
    } catch (error) {
      tokenRecord.usedAt = new Date();
      await this.resetTokenRepo.save(tokenRecord);
      throw error;
    }

    return {
      message: 'Mã xác minh đã được gửi đến email.',
      expiresIn: OTP_TTL_SECONDS,
    };
  }

  async verifyResetOtp(
    dto: VerifyResetOtpDto,
  ): Promise<{ resetToken: string }> {
    const user = await this.userRepo.findOne({
      where: {
        email: dto.email.trim().toLowerCase(),
        status: 'ACTIVE',
        deletedAt: IsNull(),
      },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: 'RESOURCE_NOT_FOUND',
        message: 'Tài khoản không tồn tại trong hệ thống',
      });
    }

    const tokenHash = this.hashOtp(user.id, dto.otp.trim());
    const record = await this.resetTokenRepo.findOne({
      where: { userId: user.id, tokenHash, usedAt: IsNull() },
    });

    if (!record) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_ERROR',
        message: 'Mã xác minh OTP không chính xác',
        errors: [
          {
            field: 'otp',
            rule: 'match',
            message: 'Mã xác minh OTP không chính xác',
          },
        ],
      });
    }

    if (record.expiresAt < new Date()) {
      throw new UnprocessableEntityException({
        errorCode: 'UNPROCESSABLE_ENTITY',
        message: 'Mã OTP đã hết hạn, vui lòng yêu cầu mã mới',
      });
    }

    // Mark the OTP as used
    record.usedAt = new Date();
    await this.resetTokenRepo.save(record);

    // Generate secure single-use resetToken
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = this.hashResetToken(rawResetToken);
    const resetTokenExpiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_SECONDS * 1000,
    );

    const resetRecord = this.resetTokenRepo.create({
      userId: user.id,
      tokenHash: resetTokenHash,
      expiresAt: resetTokenExpiresAt,
      usedAt: null,
    });
    await this.resetTokenRepo.save(resetRecord);

    return { resetToken: rawResetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<null> {
    const resetTokenHash = this.hashResetToken(dto.resetToken.trim());
    const resetRecord = await this.resetTokenRepo.findOne({
      where: { tokenHash: resetTokenHash, usedAt: IsNull() },
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      throw new UnprocessableEntityException({
        errorCode: 'UNPROCESSABLE_ENTITY',
        message: 'Đường dẫn đặt lại mật khẩu đã hết hạn hoặc không hợp lệ',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const tokenRepo = manager.getRepository(PasswordResetTokenEntity);
      const refreshTokenRepo = manager.getRepository(RefreshTokenEntity);

      const user = await userRepo.findOne({
        where: {
          id: resetRecord.userId,
          status: 'ACTIVE',
          deletedAt: IsNull(),
        },
      });

      if (!user) {
        throw new NotFoundException({
          errorCode: 'RESOURCE_NOT_FOUND',
          message: 'Tài khoản người dùng không tồn tại',
        });
      }

      // BR-01: Check if new password is same as current password (if passwordHash exists)
      if (
        user.passwordHash &&
        (await argon2.verify(user.passwordHash, dto.newPassword))
      ) {
        throw new BadRequestException({
          errorCode: 'VALIDATION_ERROR',
          message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại',
          errors: [
            {
              field: 'newPassword',
              rule: 'notSameAsOld',
              message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại',
            },
          ],
        });
      }

      const passwordHash = await argon2.hash(dto.newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });

      user.passwordHash = passwordHash;
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await userRepo.save(user);

      resetRecord.usedAt = new Date();
      await tokenRepo.save(resetRecord);

      // Invalidate all active refresh tokens on all devices
      await refreshTokenRepo.update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });

    return null;
  }

  private hashOtp(userId: string, otp: string): string {
    return crypto
      .createHash('sha256')
      .update(`OTP:${userId}:${otp}`)
      .digest('hex');
  }

  private hashResetToken(rawToken: string): string {
    return crypto
      .createHash('sha256')
      .update(`RESET_TOKEN:${rawToken}`)
      .digest('hex');
  }
}
