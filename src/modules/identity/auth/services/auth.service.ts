import {
  Injectable,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity } from '../../domain/user.entity.js';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { LoginDto } from '../dtos/login.dto.js';
import { TokenService } from './token.service.js';
import type { VerifiedGoogleIdentity } from './google-id-token.service.js';

type SafeUser = Omit<UserEntity, 'passwordHash' | 'googleSub'>;
type AuthResult = {
  user: SafeUser;
  accessToken: string;
  rawRefreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly tokenService: TokenService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto): Promise<SafeUser> {
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

    const saved = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const user = users.create({
        email: dto.email,
        phone: dto.phone || null,
        passwordHash,
        fullName: dto.fullName,
        status: 'ACTIVE',
      });
      const created = await users.save(user);
      const assignments = await manager.query<Array<{ role_id: string }>>(
        `INSERT INTO identity.user_roles (user_id, role_id)
         SELECT $1, id
           FROM identity.roles
          WHERE code = 'BUYER' AND deleted_at IS NULL
         ON CONFLICT (user_id, role_id) DO NOTHING
         RETURNING role_id`,
        [created.id],
      );
      if (assignments.length !== 1) {
        throw new InternalServerErrorException(
          'Default BUYER role is not configured',
        );
      }
      return created;
    });
    const { passwordHash: _, googleSub: __, ...result } = saved;
    return result as SafeUser;
  }

  async login(
    dto: Pick<LoginDto, 'email' | 'password'>,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
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
      if (
        !user.passwordHash ||
        !(await argon2.verify(user.passwordHash, dto.password))
      ) {
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
      const { passwordHash: _, googleSub: __, ...safeUser } = user;
      return {
        unauthorized: false as const,
        user: safeUser as SafeUser,
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

  async loginWithGoogle(
    identity: VerifiedGoogleIdentity,
    metadata: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const bySubject = await users.findOne({
        where: { googleSub: identity.subject },
        withDeleted: true,
      });
      const byEmail = await users.findOne({
        where: { email: ILike(identity.email) },
        withDeleted: true,
      });

      if (bySubject && byEmail && bySubject.id !== byEmail.id) {
        throw new ConflictException(
          'Google identity conflicts with an existing account',
        );
      }
      let user = bySubject ?? byEmail;
      if (user && (user.deletedAt || user.status !== 'ACTIVE')) {
        throw new ForbiddenException('Account is not eligible for login');
      }
      if (user?.googleSub && user.googleSub !== identity.subject) {
        throw new ConflictException(
          'Google identity conflicts with an existing account',
        );
      }

      if (!user) {
        user = users.create({
          email: identity.email,
          fullName: identity.fullName,
          phone: null,
          passwordHash: null,
          googleSub: identity.subject,
          status: 'ACTIVE',
        });
        user = await users.save(user);
        const assignments = await manager.query<Array<{ role_id: string }>>(
          `INSERT INTO identity.user_roles (user_id, role_id)
           SELECT $1, id
             FROM identity.roles
            WHERE code = 'BUYER' AND deleted_at IS NULL
           ON CONFLICT (user_id, role_id) DO NOTHING
           RETURNING role_id`,
          [user.id],
        );
        if (assignments.length !== 1) {
          throw new InternalServerErrorException(
            'Default BUYER role is not configured',
          );
        }
      } else if (!user.googleSub) {
        user.googleSub = identity.subject;
      }

      user.lastLoginAt = new Date();
      user = await users.save(user);
      const accessToken = await this.tokenService.generateAccessToken(user);
      const rawRefreshToken = await this.tokenService.createRefreshToken(
        user.id,
        metadata,
        manager.getRepository(RefreshTokenEntity),
      );
      const { passwordHash: _, googleSub: __, ...safeUser } = user;
      return { user: safeUser as SafeUser, accessToken, rawRefreshToken };
    });
  }
}
