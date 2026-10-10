import {
  Injectable,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { LoginDto } from '../dtos/login.dto.js';
import { TokenService } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly tokenService: TokenService,
    private readonly dataSource: DataSource,
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
    const result = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const user = await users
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.email = :email', { email: dto.email })
        .andWhere('user.deleted_at IS NULL')
        .andWhere('user.status = :status', { status: 'ACTIVE' })
        .getOne();
      if (!user) return { unauthorized: true as const };

      const now = new Date();
      if (user.lockedUntil && user.lockedUntil > now) {
        const remainingMinutes = Math.ceil(
          (user.lockedUntil.getTime() - now.getTime()) / 60000,
        );
        throw new ForbiddenException(
          `Tài khoản đang tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau ${remainingMinutes} phút`,
        );
      }
      if (!(await argon2.verify(user.passwordHash, dto.password))) {
        const attempts = user.failedLoginAttempts + 1;
        if (attempts >= 5) {
          user.failedLoginAttempts = 0;
          user.lockedUntil = new Date(now.getTime() + 15 * 60000);
        } else {
          user.failedLoginAttempts = attempts;
        }
        await users.save(user);
        return { unauthorized: true as const };
      }

      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = now;
      await users.save(user);
      const accessToken = await this.tokenService.generateAccessToken(user);
      const rawRefreshToken = await this.tokenService.createRefreshToken(
        user.id,
        metadata,
        manager.getRepository(RefreshTokenEntity),
      );
      const { passwordHash: _, ...safeUser } = user;
      return {
        unauthorized: false as const,
        user: safeUser as Omit<UserEntity, 'passwordHash'>,
        accessToken,
        rawRefreshToken,
      };
    });
    if (result.unauthorized) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }
    const { unauthorized: _, ...authenticated } = result;
    return authenticated;
  }
}
