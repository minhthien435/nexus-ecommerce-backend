import { AddAvatarUrlToUsers1760076000000 } from './1760076000000-AddAvatarUrlToUsers.js';

describe('AddAvatarUrlToUsers migration', () => {
  it('adds and removes the nullable varchar(2048) column manually', async () => {
    const queryRunner = { query: vi.fn().mockResolvedValue(undefined) };
    const migration = new AddAvatarUrlToUsers1760076000000();

    await migration.up(queryRunner as never);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'ALTER TABLE "identity"."users" ADD "avatar_url" varchar(2048)',
    );

    await migration.down(queryRunner as never);
    expect(queryRunner.query).toHaveBeenLastCalledWith(
      'ALTER TABLE "identity"."users" DROP COLUMN "avatar_url"',
    );
  });
});
