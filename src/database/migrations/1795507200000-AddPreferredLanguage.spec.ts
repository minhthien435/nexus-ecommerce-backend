import { expect, it } from 'vitest';
import {
  createTestPostgres,
  hasTestPostgres,
} from '../../../test/support/isolated-postgres.js';
import { AddPreferredLanguage1795507200000 } from './1795507200000-AddPreferredLanguage.js';

it.skipIf(!hasTestPostgres)(
  'keeps old accounts unselected, enforces vi/en and supports rollback',
  async () => {
    const { db, close } = await createTestPostgres();
    const runner = db.createQueryRunner();
    const migration = new AddPreferredLanguage1795507200000();
    try {
      await runner.query(
        'CREATE SCHEMA identity; CREATE TABLE identity.users (id integer PRIMARY KEY); INSERT INTO identity.users VALUES (1)',
      );
      await migration.up(runner);
      expect(
        await runner.query('SELECT preferred_language FROM identity.users'),
      ).toEqual([{ preferred_language: null }]);
      for (const lang of ['vi', 'en']) {
        expect(
          (
            await runner.query(
              'UPDATE identity.users SET preferred_language=$1 RETURNING preferred_language',
              [lang],
            )
          )[0],
        ).toEqual([{ preferred_language: lang }]);
      }
      await expect(
        runner.query("UPDATE identity.users SET preferred_language='fr'"),
      ).rejects.toMatchObject({ code: '23514' });
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM identity.users')).toEqual([
        { id: 1 },
      ]);
      await migration.up(runner);
      expect(
        await runner.query('SELECT preferred_language FROM identity.users'),
      ).toEqual([{ preferred_language: null }]);
    } finally {
      await runner.release();
      await close();
    }
  },
);
