import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard.js';
import { RolesGuard } from './roles.guard.js';

function context(userId?: string) {
  const request = { user: userId ? { id: userId } : undefined };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('RBAC guards', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  it('treats role lists as any-of and returns 403 when none match', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['ADMIN', 'STAFF']),
    };
    const rbac = { hasAnyRole: vi.fn().mockResolvedValue(true) };
    await expect(
      new RolesGuard(reflector as never, rbac as never).canActivate(
        context(userId),
      ),
    ).resolves.toBe(true);
    expect(rbac.hasAnyRole).toHaveBeenCalledWith(userId, ['ADMIN', 'STAFF']);

    rbac.hasAnyRole.mockResolvedValue(false);
    await expect(
      new RolesGuard(reflector as never, rbac as never).canActivate(
        context(userId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats permission lists as all-of and returns 403 when one is missing', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['USER.VIEW', 'USER.UPDATE']),
    };
    const rbac = { hasAllPermissions: vi.fn().mockResolvedValue(false) };
    await expect(
      new PermissionsGuard(reflector as never, rbac as never).canActivate(
        context(userId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
      'USER.VIEW',
      'USER.UPDATE',
    ]);
  });

  it('returns 401 when protected metadata exists without an authenticated user', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['ADMIN']) };
    const rbac = { hasAnyRole: vi.fn() };
    await expect(
      new RolesGuard(reflector as never, rbac as never).canActivate(context()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows routes that declare no RBAC metadata', async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    const rbac = { hasAnyRole: vi.fn() };
    await expect(
      new RolesGuard(reflector as never, rbac as never).canActivate(context()),
    ).resolves.toBe(true);
    expect(rbac.hasAnyRole).not.toHaveBeenCalled();
  });
});
