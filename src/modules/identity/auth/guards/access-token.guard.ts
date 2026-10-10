import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { IsNull, Repository } from 'typeorm';
import { UserEntity } from '../../domain/user.entity.js';

type AccessTokenClaims = { sub?: unknown; tokenVersion?: unknown };
type AuthenticatedRequest = Request & { user?: { id: string } };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const parts = authorization?.split(' ');

    if (parts?.length !== 2 || parts[0] !== 'Bearer' || parts[1].length === 0) {
      throw new UnauthorizedException();
    }

    try {
      const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(
        parts[1],
      );
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        typeof claims.tokenVersion !== 'number' ||
        !Number.isInteger(claims.tokenVersion)
      ) {
        throw new UnauthorizedException();
      }
      const user = await this.users.findOne({
        where: { id: claims.sub, status: 'ACTIVE', deletedAt: IsNull() },
        select: { id: true, tokenVersion: true },
      });
      if (!user || user.tokenVersion !== claims.tokenVersion) {
        throw new UnauthorizedException();
      }
      request.user = { id: claims.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
