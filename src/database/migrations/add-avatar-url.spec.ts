import type { QueryRunner } from 'typeorm';
import { AddAvatarUrlToUsers1791590400000 } from './1791590400000-AddAvatarUrlToUsers.js';

describe('AddAvatarUrlToUsers migration', () => {
  it('adds and removes the nullable varchar(2048) column', async () => {
    const runner = {
      query: vi.fn(async () => undefined),
    } as unknown as QueryRunner;
    const migration = new AddAvatarUrlToUsers1791590400000();
    await migration.up(runner);
    await migration.down(runner);
    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/ADD "avatar_url" character varying\(2048\)/),
    );
    expect(runner.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/DROP COLUMN "avatar_url"/),
    );
  });
});
