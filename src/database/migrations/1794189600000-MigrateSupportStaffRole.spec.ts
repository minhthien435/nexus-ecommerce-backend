import { describe, expect, it, vi } from 'vitest';
import { MigrateSupportStaffRole1794189600000 } from './1794189600000-MigrateSupportStaffRole.js';

describe('MigrateSupportStaffRole1794189600000', () => {
  it('idempotently assigns STAFF before removing legacy memberships and role', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new MigrateSupportStaffRole1794189600000().up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => statement as string);
    expect(sql[0]).toContain("VALUES ('STAFF'");
    expect(sql[0]).toContain('ON CONFLICT (code) DO UPDATE');
    expect(sql[1]).toContain("legacy.code = 'SUPPORT_STAFF'");
    expect(sql[1]).toContain("canonical.code = 'STAFF'");
    expect(sql[1]).toContain('ON CONFLICT (user_id, role_id) DO NOTHING');
    expect(sql[2]).toContain('DELETE FROM identity.user_roles');
    expect(sql.at(-1)).toContain(
      "DELETE FROM identity.roles WHERE code = 'SUPPORT_STAFF'",
    );
  });
});
