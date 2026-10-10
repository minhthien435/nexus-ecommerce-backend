import { UnauthorizedException } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';

const context = (authorization?: string) => {
  const request: {
    headers: { authorization: string | undefined };
    user?: { id: string };
  } = { headers: { authorization } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
};

describe('AccessTokenGuard', () => {
  it('verifies the token and assigns a valid subject', async () => {
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: '11111111-1111-4111-8111-111111111111',
      }),
    };
    const guard = new AccessTokenGuard(jwt as never);
    const test = context('Bearer valid-token');

    await expect(guard.canActivate(test.context)).resolves.toBe(true);
    expect(test.request.user).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it.each([
    undefined,
    'Basic token',
    'Bearer',
    'Bearer token garbage',
    'Bearer ',
  ])('rejects malformed authorization header %s', async (authorization) => {
    const jwt = { verifyAsync: vi.fn() };
    await expect(
      new AccessTokenGuard(jwt as never).canActivate(
        context(authorization).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and invalid subjects', async () => {
    const invalidToken = {
      verifyAsync: vi.fn().mockRejectedValue(new Error('invalid')),
    };
    await expect(
      new AccessTokenGuard(invalidToken as never).canActivate(
        context('Bearer token').context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const invalidSubject = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'not-a-uuid' }),
    };
    await expect(
      new AccessTokenGuard(invalidSubject as never).canActivate(
        context('Bearer token').context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
