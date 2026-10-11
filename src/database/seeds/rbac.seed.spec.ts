import {
  PRIVILEGE_SEEDS,
  SYSTEM_ROLES,
} from '../../modules/identity/rbac/rbac.constants.js';
import { seedInitialAdmin, seedSystemRolesAndPrivileges } from './rbac.seed.js';

describe('RBAC seed', () => {
  it('upserts every system role and the SRS privilege matrix', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await seedSystemRolesAndPrivileges({ query } as never);

    expect(query).toHaveBeenCalledTimes(
      SYSTEM_ROLES.length +
        PRIVILEGE_SEEDS.length +
        PRIVILEGE_SEEDS.reduce((total, item) => total + item.roles.length, 0),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO identity.roles'),
      expect.arrayContaining(['ADMIN']),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO identity.privileges'),
      expect.arrayContaining(['USER.ROLE.ASSIGN']),
    );
  });

  it('reuses an existing admin and assigns ADMIN idempotently', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'admin-id', deleted_at: null }])
      .mockResolvedValueOnce([{ role_id: 'admin-role' }]);

    await expect(
      seedInitialAdmin({ query } as never, {
        email: 'admin@example.com',
        password: 'Password1!',
        fullName: 'Admin',
      }),
    ).resolves.toBe('admin-id');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('never silently restores a deleted admin', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 'deleted-admin', deleted_at: new Date() }]);
    await expect(
      seedInitialAdmin({ query } as never, {
        email: 'admin@example.com',
        password: 'Password1!',
        fullName: 'Admin',
      }),
    ).rejects.toThrow('deleted account');
  });
});
