import { UnauthorizedException } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';

const id = '11111111-1111-4111-8111-111111111111';
const context = (authorization?: string) => {
  const request: any = { headers: { authorization } };
  return {
    request,
    value: { switchToHttp: () => ({ getRequest: () => request }) } as never,
  };
};

describe('AccessTokenGuard', () => {
  const users = { findOne: vi.fn() };
  beforeEach(() => vi.clearAllMocks());

  it('accepts only a matching version for an active, non-deleted user', async () => {
    users.findOne.mockResolvedValue({ id, tokenVersion: 3 });
    const test = context('Bearer valid');
    await expect(
      new AccessTokenGuard(
        {
          verifyAsync: vi.fn().mockResolvedValue({ sub: id, tokenVersion: 3 }),
        } as never,
        users as never,
      ).canActivate(test.value),
    ).resolves.toBe(true);
    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(test.request.user).toEqual({ id });
  });

  it.each([
    { sub: id },
    { sub: id, tokenVersion: '3' },
    { sub: id, tokenVersion: 3.5 },
    { sub: 'invalid', tokenVersion: 3 },
  ])('rejects invalid or legacy claims %#', async (claims) => {
    await expect(
      new AccessTokenGuard(
        { verifyAsync: vi.fn().mockResolvedValue(claims) } as never,
        users as never,
      ).canActivate(context('Bearer token').value),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([null, { id, tokenVersion: 4 }])(
    'rejects absent/inactive/deleted or stale-version users',
    async (user) => {
      users.findOne.mockResolvedValue(user);
      await expect(
        new AccessTokenGuard(
          {
            verifyAsync: vi
              .fn()
              .mockResolvedValue({ sub: id, tokenVersion: 3 }),
          } as never,
          users as never,
        ).canActivate(context('Bearer token').value),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );
});
