import { describe, expect, it, vi } from 'vitest';
import { AddGoogleIdentityToUsers1792015200000 } from './1792015200000-AddGoogleIdentityToUsers.js';

describe('AddGoogleIdentityToUsers migration', () => {
  it('makes password nullable and adds a unique Google subject', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddGoogleIdentityToUsers1792015200000().up({ query } as never);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('password_hash" DROP NOT NULL'),
      expect.stringContaining('ADD "google_sub"'),
      expect.stringContaining('UNIQUE ("google_sub")'),
    ]);
  });

  it('preflights and refuses rollback before DDL when null password hashes exist', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ has_null_passwords: true }]);

    await expect(
      new AddGoogleIdentityToUsers1792015200000().down({ query } as never),
    ).rejects.toThrow(
      'Cannot roll back Google identity migration while users with null password hashes exist',
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT EXISTS'),
    );
  });

  it('runs the normal rollback after a clean preflight', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ has_null_passwords: false }])
      .mockResolvedValue(undefined);

    await new AddGoogleIdentityToUsers1792015200000().down({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining('SELECT EXISTS'),
      expect.stringContaining('DROP CONSTRAINT "UQ_users_google_sub"'),
      expect.stringContaining('DROP COLUMN "google_sub"'),
      expect.stringContaining('password_hash" SET NOT NULL'),
    ]);
  });
});
