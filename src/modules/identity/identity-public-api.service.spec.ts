import { IdentityPublicApiService } from './identity-public-api.service.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('IdentityPublicApiService', () => {
  function setup() {
    const users = {
      findOne: vi.fn().mockResolvedValue({
        id: userId,
        fullName: 'Public User',
        status: 'ACTIVE',
      }),
      count: vi.fn().mockResolvedValue(1),
    };
    const rbac = {
      getRoles: vi.fn().mockResolvedValue(['BUYER']),
      hasAllPermissions: vi.fn().mockResolvedValue(true),
    };
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ trust_level: 'TRUSTED' }]),
    };
    return {
      service: new IdentityPublicApiService(
        users as never,
        rbac as never,
        dataSource as never,
      ),
      users,
      rbac,
      dataSource,
    };
  }

  it('returns only a stable public projection', async () => {
    const { service, users } = setup();
    await expect(service.getPublicUser(userId)).resolves.toEqual({
      id: userId,
      fullName: 'Public User',
      status: 'ACTIVE',
      roles: ['BUYER'],
      trustLevel: 'TRUSTED',
    });
    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, fullName: true, status: true },
      }),
    );
  });

  it('returns null for missing/deleted users without querying downstream data', async () => {
    const { service, users, rbac, dataSource } = setup();
    users.findOne.mockResolvedValue(null);
    await expect(service.getPublicUser(userId)).resolves.toBeNull();
    expect(rbac.getRoles).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('exposes status and authorization checks without repositories', async () => {
    const { service, rbac } = setup();
    await expect(service.isActiveUser(userId)).resolves.toBe(true);
    await expect(service.getUserRoles(userId)).resolves.toEqual(['BUYER']);
    await expect(service.hasPermission(userId, 'PROFILE.VIEW')).resolves.toBe(
      true,
    );
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
      'PROFILE.VIEW',
    ]);
  });
});
