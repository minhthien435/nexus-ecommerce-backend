import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';

// Never import dotenv or use the application's database configuration here.
const rawUrl = process.env.REPUTATION_MIGRATION_TEST_DATABASE_URL;
if (!rawUrl) {
  throw new Error('REPUTATION_MIGRATION_TEST_DATABASE_URL is required');
}
const target = new URL(rawUrl);
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/nexus_reputation_migrations_test' ||
  target.search !== '' ||
  target.hash !== ''
) {
  throw new Error(
    'Migration verification requires the dedicated loopback nexus_reputation_migrations_test database',
  );
}

const migrationDirectory = fileURLToPath(
  new URL('../dist/database/migrations/', import.meta.url),
).replaceAll('\\', '/');
const database = new DataSource({
  type: 'postgres',
  url: rawUrl,
  ssl: false,
  synchronize: false,
  migrationsRun: false,
  migrations: [`${migrationDirectory}*.js`],
});
try {
  await database.initialize();
  const tables =
    await database.query(`SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')`);
  if (tables.length)
    throw new Error(
      'Migration verification requires an empty dedicated database; existing tables were left untouched',
    );
  const names = database.migrations.map(
    (migration) => migration.name ?? migration.constructor.name,
  );
  if (!names.includes('DurableReputationRewards1794873600000')) {
    throw new Error(
      'Compiled reputation migration is missing; run npm run build first',
    );
  }
  console.log(
    `Loaded ${names.length} actual repository migrations; synchronize=false; no fixture/bootstrap schema`,
  );
  const applied = await database.runMigrations({ transaction: 'all' });
  console.log(
    `Applied ${applied.length} migrations, including DurableReputationRewards1794873600000`,
  );
} catch (error) {
  // Do not print connection details, credentials or arbitrary error objects.
  console.error(
    `Migration-chain verification failed: ${error.code ?? error.name}`,
  );
  if (
    error.query?.startsWith('ALTER TABLE "identity"."users" ADD "avatar_url"')
  ) {
    console.error(
      'Blocked at AddAvatarUrlToUsers1760076000000: missing identity/users bootstrap; new reputation migration was not reached',
    );
  }
  process.exitCode = 1;
} finally {
  if (database.isInitialized) await database.destroy();
}
