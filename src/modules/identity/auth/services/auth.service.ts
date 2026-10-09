import {
  Injectable,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { LoginDto } from '../dtos/login.dto.js';
import { TokenService } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly tokenService: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<Omit<UserEntity, 'passwordHash'>> {
    const existing = await this.userRepo.findOne({
      where: [
        { email: dto.email },
        ...(dto.phone ? [{ phone: dto.phone }] : []),
      ],
    });

    if (existing) {
      throw new ConflictException('Email hoặc số điện thoại đã được đăng ký');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
    });

    const user = this.userRepo.create({
      email: dto.email,
      phone: dto.phone || null,
      passwordHash,
      fullName: dto.fullName,
      status: 'ACTIVE',
    });

    const saved = await this.userRepo.save(user);
    const { passwordHash: _, ...result } = saved;
    return result as Omit<UserEntity, 'passwordHash'>;
  }

  async login(
    dto: LoginDto,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<{
    user: Omit<UserEntity, 'passwordHash'>;
    accessToken: string;
    rawRefreshToken: string;
  }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    // 1. Kiểm tra khóa tài khoản (locked_until > now)
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const remainingMinutes = Math.ceil(
        (user.lockedUntil.getTime() - now.getTime()) / 60000,
      );
      throw new ForbiddenException(
        `Tài khoản đang tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau ${remainingMinutes} phút`,
      );
    }

    // 2. Xác thực Argon2id
    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    if (!isPasswordValid) {
      const attempts = user.failedLoginAttempts + 1;
      if (attempts >= 5) {
        user.failedLoginAttempts = 0;
        user.lockedUntil = new Date(now.getTime() + 15 * 60000); // Khóa 15 phút
      } else {
        user.failedLoginAttempts = attempts;
      }
      await this.userRepo.save(user);
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    // 3. Đăng nhập thành công -> Reset lockout
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    await this.userRepo.save(user);

    // 4. Tạo Tokens
    const accessToken = await this.tokenService.generateAccessToken(user);
    const rawRefreshToken = await this.tokenService.createRefreshToken(
      user.id,
      metadata,
    );

    const { passwordHash: _, ...safeUser } = user;
    return {
      user: safeUser as Omit<UserEntity, 'passwordHash'>,
      accessToken,
      rawRefreshToken,
    };
  }
}
