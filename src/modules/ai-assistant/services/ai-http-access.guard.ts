import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  HttpException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { AiAccessPolicy } from '../ai-orchestrator.contract.js';
export type AiHttpRequest = Request & { user?: { id: string } };
@Injectable()
export class AiOptionalAuthGuard implements CanActivate {
  constructor(
    @Inject(AccessTokenGuard) private readonly auth: AccessTokenGuard,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiHttpRequest>();
    delete request.user;
    if (request.headers.authorization !== undefined)
      await this.auth.canActivate(context);
    return true;
  }
}
/** Bounded local protection for the sample endpoint; Minh replaces with Redis/fallback policy. */
@Injectable()
export class AiSampleAccessPolicy extends AiAccessPolicy {
  private readonly windows = new Map<
    string,
    { count: number; until: number }
  >();
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AiHttpRequest>();
    const now = Date.now();
    for (const [key, value] of this.windows)
      if (value.until <= now) this.windows.delete(key);
    const key = request.user
      ? 'user:' + request.user.id
      : 'ip:' + (request.ip ?? request.socket.remoteAddress ?? 'unknown');
    let window = this.windows.get(key);
    if (!window && this.windows.size < 10000) {
      window = { count: 0, until: now + 60000 };
      this.windows.set(key, window);
    }
    if (!window || window.count >= (request.user ? 20 : 10)) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((window?.until ?? now + 60000) - now) / 1000),
      );
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          errorCode: 'AI_RATE_LIMITED',
          message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
          data: { retryAfterSeconds },
        },
        429,
      );
    }
    window.count++;
    return true;
  }
}
