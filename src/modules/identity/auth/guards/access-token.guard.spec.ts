import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { AccessTokenGuard } from './access-token.guard.js';

const userId = '11111111-1111-4111-8111-111111111111';

function context(authorization?: string) {
  const request = { headers: { authorization } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe('AccessTokenGuard', () => {
  it('verifies bearer JWT and attaches its UUID subject', async () => {
    const jwt = { verifyAsync: vi.fn(async () => ({ sub: userId })) };
    const guard = new AccessTokenGuard(jwt as unknown as JwtService);
    const { request, context: executionContext } = context('Bearer token');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request).toHaveProperty('user', { id: userId });
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer token garbage'])(
    'rejects missing or malformed authorization %s',
    async (authorization) => {
      const guard = new AccessTokenGuard({} as JwtService);
      await expect(
        guard.canActivate(context(authorization).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejects invalid tokens and non-UUID subjects', async () => {
    const jwt = { verifyAsync: vi.fn(async () => ({ sub: 'not-a-uuid' })) };
    const guard = new AccessTokenGuard(jwt as unknown as JwtService);
    await expect(
      guard.canActivate(context('Bearer token').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
