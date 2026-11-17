import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DataSource } from 'typeorm';

// Supply exported original SQL; never fetch from a shared DB or load .env here.
const root = fileURLToPath(new URL('../', import.meta.url));
const rawUrl = process.env.REPUTATION_BASELINE_TEST_DATABASE_URL;
const defaultSqlDir = join(root, 'test/fixtures/database-baseline');
const sqlDirectory = process.env.REPUTATION_BASELINE_SQL_DIR || defaultSqlDir;
if (!rawUrl) {
  throw new Error('REPUTATION_BASELINE_TEST_DATABASE_URL is required');
}
const isCi = process.env.GITLAB_CI === 'true' || process.env.CI === 'true';
const allowedHostnames = ['127.0.0.1', 'localhost', '[::1]'];
if (isCi) {
  allowedHostnames.push('postgres');
}
const target = new URL(rawUrl);
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !allowedHostnames.includes(target.hostname) ||
  ![
    '/nexus_reputation_baseline_test',
    '/nexus_reputation_baseline_final_test',
  ].includes(target.pathname) ||
  target.search ||
  target.hash
) {
  throw new Error(
    'Authoritative baseline verification requires a dedicated loopback baseline test database',
  );
}
const manifest = JSON.parse(
  readFileSync(
    join(root, 'test/fixtures/reputation-official-baseline.manifest.json'),
    'utf8',
  ),
);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceSql = manifest.baseline.map((entry) => {
  const sql = readFileSync(join(resolve(sqlDirectory), entry.file));
  assert.equal(
    digest(sql),
    entry.sha256,
    `Original SQL checksum mismatch: ${entry.name}`,
  );
  return { entry, sql: sql.toString('utf8') };
});
for (const entry of manifest.baseMigrations) {
  const source = readFileSync(join(root, entry.file), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
  assert.equal(
    digest(source),
    entry.sha256,
    `Historical migration differs from pinned base: ${entry.name}`,
  );
}
const db = new DataSource({
  type: 'postgres',
  url: rawUrl,
  ssl: false,
  synchronize: false,
  migrationsRun: false,
  migrations: [
    join(root, 'dist/database/migrations/*.js').replaceAll('\\', '/'),
  ],
});
const report = {
  source: manifest.source,
  baseCommit: manifest.baseCommit,
  baseline: manifest.baseline,
  baseMigrations: [],
  pendingMigrations: [],
  rerun: [],
  constraintChecks: [],
};
let stage = 'connect';
let succeeded = false;
try {
  await db.initialize();
  const existing =
    await db.query(`SELECT table_schema,table_name FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')`);
  assert.equal(
    existing.length,
    0,
    'Target must be empty; existing tables were not modified',
  );
  for (const { entry, sql } of sourceSql) {
    stage = entry.name;
    await db.transaction(async (manager) => manager.query(sql));
    console.log(`Applied original baseline: ${entry.name}`);
  }

  const all = [...db.migrations];
  const nameOf = (migration) => migration.name ?? migration.constructor.name;
  const expected = [
    ...manifest.baseMigrations.map((migration) => migration.name),
    manifest.reputationMigration.name,
  ];
  assert.deepEqual(
    all.map(nameOf).sort(),
    [...expected].sort(),
    'Compiled migration set must match pinned base plus reputation',
  );
  db.migrations = manifest.baseMigrations.map((entry) =>
    all.find((migration) => nameOf(migration) === entry.name),
  );
  stage = 'base migration chain';
  report.baseMigrations = (await db.runMigrations({ transaction: 'all' })).map(
    (migration) => migration.name,
  );
  assert.deepEqual(
    report.baseMigrations,
    manifest.baseMigrations.map((migration) => migration.name),
  );
  const historyBefore = await db.query(
    'SELECT name FROM public.migrations ORDER BY timestamp,id',
  );
  assert.deepEqual(
    historyBefore.map((row) => row.name),
    report.baseMigrations,
  );
  console.log(
    `Applied ${report.baseMigrations.length} actual base migrations; history recorded by TypeORM`,
  );

  // Synthetic legacy DATA only, inserted into the actual migrated schema.
  stage = 'legacy backfill data';
  const userId = randomUUID();
  await db.query(
    `INSERT INTO identity.users(id,email,full_name,password_hash)
    VALUES($1,$2,'Legacy migration verification','test-only-not-a-login-hash')`,
    [userId, `${userId}@example.invalid`],
  );
  await db.query(
    `INSERT INTO identity.reputation_scores(user_id,score,trust_level) VALUES($1,80,'TRUSTED')`,
    [userId],
  );
  await db.query(
    `INSERT INTO identity.reputation_history
    (user_id,old_score,new_score,old_trust_level,new_trust_level,delta,reason,source_type,created_at)
    VALUES($1,50,65,'STANDARD','STANDARD',15,'Synthetic legacy test','PROFILE_COMPLETION','2026-01-01'),
      ($1,65,80,'STANDARD','TRUSTED',15,'Synthetic duplicate legacy test','PROFILE_COMPLETION','2026-01-02')`,
    [userId],
  );

  db.migrations = all;
  stage = 'pending reputation upgrade';
  report.pendingMigrations = (
    await db.runMigrations({ transaction: 'all' })
  ).map((migration) => migration.name);
  assert.deepEqual(report.pendingMigrations, [
    manifest.reputationMigration.name,
  ]);
  report.rerun = (await db.runMigrations({ transaction: 'all' })).map(
    (migration) => migration.name,
  );
  assert.deepEqual(report.rerun, []);
  report.history = await db.query(
    'SELECT timestamp::text,name FROM public.migrations ORDER BY timestamp,id',
  );
  assert.deepEqual(
    report.history.map((row) => row.name),
    expected,
  );
  report.backfill = (
    await db.query(
      `SELECT
    (SELECT COUNT(*)::int FROM identity.profile_completion_rewards) AS claims,
    (SELECT COUNT(*)::int FROM identity.reputation_history) AS history,
    (SELECT score FROM identity.reputation_scores WHERE user_id=$1) AS score,
    (SELECT created_at FROM identity.profile_completion_rewards WHERE user_id=$1) =
      (SELECT MIN(created_at) FROM identity.reputation_history WHERE user_id=$1) AS earliest_timestamp`,
      [userId],
    )
  )[0];
  assert.deepEqual(report.backfill, {
    claims: 1,
    history: 2,
    score: 80,
    earliest_timestamp: true,
  });

  stage = 'constraints and index';
  report.constraints =
    await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('identity.profile_completion_rewards'::regclass,'identity.shop_reputation_rewards'::regclass) ORDER BY conname`);
  for (const name of [
    'UQ_shop_reputation_reward',
    'UQ_shop_order_reward',
    'CK_shop_reputation_reward_delta',
    'CK_shop_reward_reference',
  ]) {
    assert(
      report.constraints.some((constraint) => constraint.conname === name),
      `Missing ${name}`,
    );
  }
  const foreignKeys = report.constraints.filter((constraint) =>
    constraint.definition.startsWith('FOREIGN KEY'),
  );
  assert.equal(foreignKeys.length, 3);
  assert(
    foreignKeys.every((constraint) =>
      constraint.definition.includes('ON DELETE RESTRICT'),
    ),
  );
  report.index = (
    await db.query(`SELECT i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition,pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='commerce' AND c.relname='IDX_order_delivered_reputation_clock'`)
  )[0];
  assert.equal(report.index?.indisvalid, true);
  assert(report.index.definition.includes('(order_id, created_at DESC)'));
  assert(report.index.predicate.includes('DELIVERED'));

  // Negative checks run in a rolled-back transaction; no testing DDL or disabled constraints.
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  try {
    const shopId = randomUUID();
    await runner.query(
      `INSERT INTO identity.shops(id,seller_id,name,slug,phone,warehouse_address,identity_number)
      VALUES($1,$2,'Constraint test shop',$3,'0912345678','Synthetic test address','test-identity')`,
      [shopId, userId, `constraint-${shopId}`],
    );
    await runner.query(
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,old_score,new_score,delta)
      VALUES($1,'SHOP_PROFILE_COMPLETION',$1,50,60,10)`,
      [shopId],
    );
    const orderId = randomUUID();
    await runner.query(
      `INSERT INTO commerce.orders(id,order_number,buyer_id,seller_id,status,total,shipping_address_snapshot)
      VALUES($1,$2,$3,$3,'COMPLETED',100,'{}')`,
      [orderId, `constraint-${orderId}`, userId],
    );
    const check = async (label, sql, parameters, expectedCode) => {
      await runner.query('SAVEPOINT constraint_check');
      let code;
      try {
        await runner.query(sql, parameters);
      } catch (error) {
        code = error.code;
      }
      await runner.query('ROLLBACK TO SAVEPOINT constraint_check');
      assert.equal(code, expectedCode, label);
      report.constraintChecks.push({ label, code });
    };
    await check(
      'profile unique claim',
      'INSERT INTO identity.profile_completion_rewards(user_id) VALUES($1)',
      [userId],
      '23505',
    );
    await check(
      'profile user FK',
      'INSERT INTO identity.profile_completion_rewards(user_id) VALUES($1)',
      [randomUUID()],
      '23503',
    );
    await check(
      'shop duplicate reward',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,old_score,new_score,delta)
      VALUES($1,'SHOP_PROFILE_COMPLETION',$1,50,60,10)`,
      [shopId],
      '23505',
    );
    const absentShop = randomUUID();
    await check(
      'shop FK',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,old_score,new_score,delta)
      VALUES($1,'SHOP_PROFILE_COMPLETION',$1,50,60,10)`,
      [absentShop],
      '23503',
    );
    await check(
      'shop arithmetic',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,order_id,old_score,new_score,delta)
      VALUES($1,'ORDER_COMPLETION',$2,$2,50,60,5)`,
      [shopId, orderId],
      '23514',
    );
    await check(
      'score cap',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,order_id,old_score,new_score,delta)
      VALUES($1,'ORDER_COMPLETION',$2,$2,99,101,2)`,
      [shopId, orderId],
      '23514',
    );
    await check(
      'profile reference',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,old_score,new_score,delta)
      VALUES($1,'SHOP_PROFILE_COMPLETION',$2,50,60,10)`,
      [shopId, randomUUID()],
      '23514',
    );
    await check(
      'order FK',
      `INSERT INTO identity.shop_reputation_rewards(shop_id,source_type,reference_id,order_id,old_score,new_score,delta)
      VALUES($1,'ORDER_COMPLETION',$2,$2,50,55,5)`,
      [shopId, randomUUID()],
      '23503',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log(
    `Applied only ${report.pendingMigrations[0]}; rerun 0; backfill 1 claim/2 history/score 80; ${report.constraintChecks.length} negative constraint checks passed`,
  );
  succeeded = true;
} catch (error) {
  report.failure = { stage, code: error.code ?? error.name };
  console.error(
    `Official baseline verification failed at ${stage}: ${report.failure.code}`,
  );
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
  mkdirSync(join(root, '_bmad-output'), { recursive: true });
  writeFileSync(
    join(root, '_bmad-output/reputation-official-baseline-run.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
if (succeeded && !process.argv.includes('--prepare-only')) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/test-reputation-db.mjs'), ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        REPUTATION_TEST_DATABASE_URL: rawUrl,
        REPUTATION_TEST_DATABASE_REQUIRED: '1',
        REPUTATION_TEST_SCHEMA_MODE: 'migrated',
      },
    },
  );
  process.exitCode = result.status ?? 1;
}
