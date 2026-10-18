import { BadRequestException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class GuestCartInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { body } = context.switchToHttp().getRequest<{
      body?: { guestCartItems?: unknown };
    }>();
    const rows = body?.guestCartItems;
    if (!Array.isArray(rows)) return true;
    // Guards run before the global ValidationPipe. Nest/class-transformer
    // remove these own JSON keys before nested whitelist validation sees them.
    for (const row of rows) {
      if (
        row !== null &&
        typeof row === 'object' &&
        (Object.hasOwn(row, 'constructor') || Object.hasOwn(row, '__proto__'))
      ) {
        throw new BadRequestException({
          errorCode: 'VALIDATION_ERROR',
          message: 'Guest cart items contain unsupported properties',
        });
      }
    }
    return true;
  }
}
