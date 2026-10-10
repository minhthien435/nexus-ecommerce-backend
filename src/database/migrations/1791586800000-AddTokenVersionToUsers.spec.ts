import { AddTokenVersionToUsers1791586800000 } from './1791586800000-AddTokenVersionToUsers.js';

describe('AddTokenVersionToUsers1791586800000', () => {
  it('adds and removes the required column', async () => {
    const runner = { query: vi.fn() };
    const migration = new AddTokenVersionToUsers1791586800000();
    await migration.up(runner as never);
    await migration.down(runner as never);
    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      'ALTER TABLE "identity"."users" ADD "token_version" integer NOT NULL DEFAULT 0',
    );
    expect(runner.query).toHaveBeenNthCalledWith(
      2,
      'ALTER TABLE "identity"."users" DROP COLUMN "token_version"',
    );
  });
});
