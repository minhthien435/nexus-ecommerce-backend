import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

type AccessTokenClaims = { sub?: unknown };
type AuthenticatedRequest = Request & { user?: { id: string } };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

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
      if (typeof claims.sub !== 'string' || !isUUID(claims.sub)) {
        throw new UnauthorizedException();
      }
      request.user = { id: claims.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
