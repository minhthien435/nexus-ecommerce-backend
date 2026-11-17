import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type EntityManager } from 'typeorm';
import { OrderStateMachineService } from '../../commerce/services/order-state-machine.service.js';
import { OrderEntity } from '../../commerce/domain/entities/order.entity.js';
import { OrderStatusHistoryEntity } from '../../commerce/domain/entities/order-status-history.entity.js';
import { CheckoutSessionEntity } from '../../commerce/domain/entities/checkout-session.entity.js';
import { OrderItemEntity } from '../../commerce/domain/entities/order-item.entity.js';
import { DurableReputationRewards1794873600000 } from '../../../database/migrations/1794873600000-DurableReputationRewards.js';
import { ProfileUserEntity } from '../users/entities/profile-user.entity.js';
import { ProfileService } from '../users/profile/profile.service.js';
import { IdentityReputationService } from './identity-reputation.service.js';
import { OrderCompletionProcessor } from '../../commerce/processors/order-completion.processor.js';

// Optional in ordinary runs; the explicit runner requires this suite, including in full runs.
// Never import dotenv or silently fall back to the application DB.
const url = process.env.REPUTATION_TEST_DATABASE_URL;
const schemaMode = process.env.REPUTATION_TEST_SCHEMA_MODE ?? 'fixture';
if (!['fixture', 'migrated'].includes(schemaMode)) {
  throw new Error('REPUTATION_TEST_SCHEMA_MODE must be fixture or migrated');
}
const migrated = schemaMode === 'migrated';
const permittedDatabases = migrated
  ? ['/nexus_reputation_baseline_test', '/nexus_reputation_baseline_final_test']
  : ['/nexus_reputation_test'];
if (process.env.REPUTATION_TEST_DATABASE_REQUIRED === '1' && !url) {
  throw new Error(
    'REPUTATION_TEST_DATABASE_URL is required when REPUTATION_TEST_DATABASE_REQUIRED=1',
  );
}
if (url) {
  const target = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    !permittedDatabases.includes(target.pathname) ||
    target.search !== ''
  ) {
    throw new Error(
      `Reputation integration tests require a dedicated loopback database for ${schemaMode} mode: ${permittedDatabases.join(', ')}`,
    );
  }
}

describe.skipIf(!url)('durable reputation (isolated PostgreSQL)', () => {
  let db: DataSource;
  let reputation: IdentityReputationService;
  let profiles: ProfileService;
  let backfill: { claims: number; history: number; score: number };

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url,
      entities: [
        ProfileUserEntity,
        OrderEntity,
        OrderStatusHistoryEntity,
        CheckoutSessionEntity,
        OrderItemEntity,
      ],
      synchronize: false,
      extra: { max: 16 },
    });
    await db.initialize();
    if (migrated) {
      // Validate provenance before removing data; never apply migration.up in this mode.
      const history = await db.query<Array<{ name: string }>>(
        'SELECT name FROM public.migrations ORDER BY id',
      );
      const manifest = JSON.parse(
        readFileSync(
          new URL(
            '../../../../test/fixtures/reputation-official-baseline.manifest.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ) as {
        baseMigrations: Array<{ name: string }>;
        reputationMigration: { name: string };
      };
      expect(history.map((row) => row.name)).toEqual([
        ...manifest.baseMigrations.map((migration) => migration.name),
        manifest.reputationMigration.name,
      ]);
      const [tables] = await db.query(
        `SELECT to_regclass('identity.profile_completion_rewards') AS personal,
          to_regclass('identity.shop_reputation_rewards') AS shop`,
      );
      expect(tables.personal).toBeTruthy();
      expect(tables.shop).toBeTruthy();
    } else {
      // Schemas are disposable ONLY within the explicit dedicated target checked above.
      await db.query(
        'DROP SCHEMA IF EXISTS auction CASCADE; DROP SCHEMA IF EXISTS commerce CASCADE; DROP SCHEMA IF EXISTS identity CASCADE',
      );
      await db.query(`
      CREATE SCHEMA identity; CREATE SCHEMA commerce; CREATE SCHEMA auction;
      CREATE TABLE identity.users (id uuid PRIMARY KEY, email varchar UNIQUE NOT NULL, password_hash varchar(255) NOT NULL, full_name varchar(150) NOT NULL,
        phone varchar(30) UNIQUE, avatar_url varchar(2048), created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), deleted_at timestamptz);
      CREATE TABLE identity.trust_levels (code varchar PRIMARY KEY);
      INSERT INTO identity.trust_levels VALUES ('UNTRUSTED'),('STANDARD'),('TRUSTED'),('VERIFIED_ELITE');
      CREATE TABLE identity.reputation_scores (user_id uuid PRIMARY KEY REFERENCES identity.users(id), score integer NOT NULL,
        trust_level varchar REFERENCES identity.trust_levels(code), rating_avg numeric DEFAULT 0, rating_count integer DEFAULT 0,
        version integer DEFAULT 1, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE identity.reputation_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES identity.users(id),
        old_score integer, new_score integer, old_trust_level varchar, new_trust_level varchar, delta integer, reason text, source_type varchar, created_at timestamptz DEFAULT NOW());
      CREATE TABLE identity.penalties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES identity.users(id),
        violation_type varchar, severity varchar, score_delta integer, reference_type varchar, reference_id uuid, reason text,
        created_at timestamptz DEFAULT NOW());
      CREATE TABLE auction.bidder_eligibility (user_id uuid PRIMARY KEY REFERENCES identity.users(id), reputation_score integer, trust_level varchar,
        is_restricted boolean, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE identity.roles (id uuid PRIMARY KEY, code varchar, deleted_at timestamptz);
      CREATE TABLE identity.user_roles (user_id uuid, role_id uuid);
      CREATE TABLE identity.shops (id uuid PRIMARY KEY, seller_id uuid REFERENCES identity.users(id), name varchar(150), slug varchar(180) NOT NULL, phone varchar(30),
        warehouse_address text, identity_number varchar(100), reputation_score integer NOT NULL DEFAULT 50, deleted_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE UNIQUE INDEX shops_seller ON identity.shops(seller_id) WHERE deleted_at IS NULL;
      CREATE TABLE commerce.orders (id uuid PRIMARY KEY, order_number varchar(50) UNIQUE NOT NULL,
        checkout_session_id uuid, buyer_id uuid NOT NULL, seller_id uuid REFERENCES identity.users(id),
        source varchar(20) NOT NULL DEFAULT 'CART', auction_id uuid, status varchar(30),
        subtotal numeric(18,2) NOT NULL DEFAULT 100, discount_amount numeric(18,2) NOT NULL DEFAULT 0,
        shipping_fee numeric(18,2) NOT NULL DEFAULT 0, tax numeric(18,2) NOT NULL DEFAULT 0,
        total numeric(18,2) NOT NULL DEFAULT 100, currency char(3) NOT NULL DEFAULT 'VND',
        shipping_address_snapshot jsonb NOT NULL DEFAULT '{}', tracking_code varchar(100), carrier_name varchar(100),
        delivered_at timestamptz, hold_expires_at timestamptz, idempotency_key varchar(100) UNIQUE,
        created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE commerce.order_status_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES commerce.orders(id),
        from_status varchar(30), to_status varchar(30) NOT NULL, reason text, changed_by uuid,
        created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE commerce.order_disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE REFERENCES commerce.orders(id), status varchar);
      CREATE TABLE commerce.order_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE REFERENCES commerce.orders(id), amount numeric, status varchar);
    `);
      const legacy = await user({ score: 80 });
      await db.query(
        `INSERT INTO identity.reputation_history(user_id, source_type) VALUES ($1,'PROFILE_COMPLETION'),($1,'PROFILE_COMPLETION')`,
        [legacy],
      );
      const runner = db.createQueryRunner();
      await runner.startTransaction();
      try {
        await new DurableReputationRewards1794873600000().up(runner);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    }
    // Capture the real prepared backfill before beforeEach removes test data.
    backfill = {
      score: Number(
        (await db.query('SELECT score FROM identity.reputation_scores'))[0]
          ?.score,
      ),
      claims: Number(
        (
          await db.query(
            'SELECT COUNT(*) FROM identity.profile_completion_rewards',
          )
        )[0].count,
      ),
      history: Number(
        (await db.query('SELECT COUNT(*) FROM identity.reputation_history'))[0]
          .count,
      ),
    };
    reputation = new IdentityReputationService(db);
    profiles = new ProfileService(
      db.getRepository(ProfileUserEntity),
      db,
      { list: async () => [] } as never,
      reputation,
    );
  }, 30000);

  beforeEach(async () => {
    await db.query(
      'TRUNCATE identity.users, commerce.orders, auction.bidder_eligibility CASCADE',
    );
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  async function user(
    fields: {
      fullName?: string;
      phone?: string | null;
      avatarUrl?: string | null;
      score?: number;
    } = {},
  ) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO identity.users(id,email,full_name,phone,avatar_url,password_hash) VALUES ($1,$2,$3,$4,$5,'SYNTHETIC_TEST_NON_LOGIN_PASSWORD_HASH')`,
      [
        id,
        `${id}@example.com`,
        fields.fullName ?? 'Test User',
        fields.phone === undefined ? null : fields.phone,
        fields.avatarUrl === undefined ? null : fields.avatarUrl,
      ],
    );
    if (fields.score !== undefined)
      await db.query(
        `INSERT INTO identity.reputation_scores(user_id,score,trust_level) VALUES ($1,$2,'STANDARD')`,
        [id, fields.score],
      );
    return id;
  }
  async function shop(score = 50, fields: Record<string, unknown> = {}) {
    const sellerId = await user();
    const id = randomUUID();
    await db.query(
      `INSERT INTO identity.shops(id,seller_id,name,phone,warehouse_address,identity_number,reputation_score,slug)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        sellerId,
        fields.name ?? 'Valid shop',
        fields.phone ?? '0912345678',
        fields.warehouseAddress ?? 'Valid address',
        fields.identityNumber ?? '123456789',
        score,
        id,
      ],
    );
    return { id, sellerId };
  }
  async function order(sellerId: string, status = 'COMPLETED', hours = 73) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO commerce.orders(id,order_number,buyer_id,seller_id,status,delivered_at,shipping_address_snapshot,total,subtotal)
        VALUES ($1,$4,$2,$2,$3,NOW()-INTERVAL '100 hours','{}',100,100)`,
      [id, sellerId, status, id],
    );
    await db.query(
      `INSERT INTO commerce.order_status_history(order_id,to_status,created_at) VALUES ($1,'DELIVERED',NOW()-$2*INTERVAL '1 hour')`,
      [id, hours],
    );
    return id;
  }
  async function dispute(orderId: string, status: string) {
    if (!migrated) {
      await db.query(
        'INSERT INTO commerce.order_disputes(order_id,status) VALUES ($1,$2)',
        [orderId, status],
      );
      return;
    }
    await db.query(
      `INSERT INTO commerce.order_disputes
      (order_id,buyer_id,seller_id,reason_category,evidence_description,status)
      SELECT id,buyer_id,seller_id,'OTHER','Synthetic reputation test evidence',$2
      FROM commerce.orders WHERE id=$1`,
      [orderId, status],
    );
  }
  async function refund(orderId: string, status: string) {
    if (!migrated) {
      await db.query(
        'INSERT INTO commerce.order_refunds(order_id,amount,status) VALUES ($1,100,$2)',
        [orderId, status],
      );
      return;
    }
    const paymentId = randomUUID();
    await db.query(
      `INSERT INTO commerce.payments(id,order_id,amount,status)
      VALUES ($1,$2,100,'SUCCEEDED')`,
      [paymentId, orderId],
    );
    await db.query(
      `INSERT INTO commerce.order_refunds
      (order_id,payment_id,refund_code,amount,currency,reason,status,payment_carrier,idempotency_key,requested_by)
      SELECT id,$2,$4,100,'VND','Synthetic reputation test refund',$3,'PAYOS',$4,buyer_id
      FROM commerce.orders WHERE id=$1`,
      [orderId, paymentId, status, paymentId],
    );
  }
  async function shopScore(id: string) {
    return (
      await db.query(
        'SELECT reputation_score FROM identity.shops WHERE id=$1',
        [id],
      )
    )[0].reputation_score;
  }
  async function count(table: string) {
    return Number((await db.query(`SELECT COUNT(*) FROM ${table}`))[0].count);
  }

  it('backfills one durable claim without deleting duplicate legacy history', () => {
    expect(backfill).toEqual({ claims: 1, history: 2, score: 80 });
  });
  it('rewards a persisted partial PATCH and keeps claim consumed after deletion/refill', async () => {
    const id = await user();
    expect(
      (await profiles.updateProfile(id, { phone: '0912345678' }))
        .profileCompletionRewarded,
    ).toBe(false);
    const complete = await profiles.updateProfile(id, {
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(complete.profileCompletionRewarded).toBe(true);
    await profiles.updateProfile(id, { phone: null, avatarUrl: null });
    expect((await profiles.getProfile(id)).profileCompletionRewarded).toBe(
      true,
    );
    await profiles.updateProfile(id, {
      phone: '0912345678',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(await count('identity.reputation_history')).toBe(1);
    expect(
      (
        await db.query(
          'SELECT score FROM identity.reputation_scores WHERE user_id=$1',
          [id],
        )
      )[0].score,
    ).toBe(65);
    expect(
      (
        await db.query(
          'SELECT * FROM auction.bidder_eligibility WHERE user_id=$1',
          [id],
        )
      )[0],
    ).toMatchObject({
      reputation_score: 65,
      is_restricted: false,
      trust_level: 'STANDARD',
    });
  });
  it.each([98, 100])(
    'concurrent first personal rewards at score %s record actual delta once',
    async (score) => {
      const id = await user({ score });
      await Promise.all(
        Array.from({ length: 8 }, () =>
          profiles.updateProfile(id, {
            phone: '0912345678',
            avatarUrl: 'https://example.com/avatar.png',
          }),
        ),
      );
      expect(await count('identity.profile_completion_rewards')).toBe(1);
      expect(
        await db.query(
          'SELECT delta,new_score,new_trust_level FROM identity.reputation_history',
        ),
      ).toEqual([
        {
          delta: 100 - score,
          new_score: 100,
          new_trust_level: 'VERIFIED_ELITE',
        },
      ]);
      expect((await profiles.getProfile(id)).profileCompletionRewarded).toBe(
        true,
      );
    },
  );
  it.each([
    {
      fullName: ' ',
      phone: '0912345678',
      avatarUrl: 'https://example.com/a.png',
    },
    { phone: 'bad', avatarUrl: 'https://example.com/a.png' },
    { phone: '0912345678', avatarUrl: 'ftp://example.com/a.png' },
    { phone: '0912345678', avatarUrl: null },
  ])(
    'does not mint for malformed or incomplete persisted personal fields: %j',
    async (fields) => {
      const id = await user(fields);
      expect(await reputation.rewardProfileCompletion(id)).toBeNull();
      expect(await count('identity.profile_completion_rewards')).toBe(0);
      expect(await count('identity.reputation_scores')).toBe(0);
    },
  );
  it('rolls profile changes, new score, claim, history and eligibility back together', async () => {
    const id = await user({
      phone: '0912345678',
      avatarUrl: 'https://example.com/a.png',
    });
    await expect(
      db.transaction(async (manager) => {
        await reputation.rewardProfileCompletion(id, manager);
        throw new Error('after reward');
      }),
    ).rejects.toThrow('after reward');
    for (const table of [
      'identity.profile_completion_rewards',
      'identity.reputation_scores',
      'identity.reputation_history',
      'auction.bidder_eligibility',
    ])
      expect(await count(table)).toBe(0);
    expect(await reputation.rewardProfileCompletion(id)).toMatchObject({
      newScore: 65,
      alreadyRewarded: false,
    });
  });

  it('rolls a real PATCH back if a failure happens after reward writes', async () => {
    const id = await user();
    const failingProfiles = new ProfileService(
      db.getRepository(ProfileUserEntity),
      db,
      { list: async () => [] } as never,
      {
        rewardProfileCompletion: async (
          userId: string,
          manager?: EntityManager,
        ) => {
          await reputation.rewardProfileCompletion(userId, manager);
          throw new Error('after reward writes');
        },
      } as unknown as IdentityReputationService,
    );
    await expect(
      failingProfiles.updateProfile(id, {
        phone: '0912345678',
        avatarUrl: 'https://example.com/a.png',
      }),
    ).rejects.toThrow('after reward writes');
    const saved = await profiles.getProfile(id);
    expect(saved).toMatchObject({
      phone: null,
      avatarUrl: null,
      profileCompletionRewarded: false,
    });
    expect(await count('identity.reputation_scores')).toBe(0);
    expect(await count('identity.reputation_history')).toBe(0);
    expect(await count('auction.bidder_eligibility')).toBe(0);
  });

  it('serializes first profile PATCH when no reputation score exists and retains restriction below50', async () => {
    const id = await user();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        profiles.updateProfile(id, {
          phone: '0912345678',
          avatarUrl: 'https://example.com/a.png',
        }),
      ),
    );
    expect(await count('identity.reputation_scores')).toBe(1);
    expect(await count('identity.reputation_history')).toBe(1);
    const low = await user({
      phone: '0812345678',
      avatarUrl: 'https://example.com/a.png',
      score: 20,
    });
    await reputation.rewardProfileCompletion(low);
    expect(
      (
        await db.query(
          'SELECT reputation_score,is_restricted,trust_level FROM auction.bidder_eligibility WHERE user_id=$1',
          [low],
        )
      )[0],
    ).toEqual({
      reputation_score: 35,
      is_restricted: true,
      trust_level: 'UNTRUSTED',
    });
  });

  it.each([
    {
      method: 'rewardAuctionPayment' as const,
      score: 68,
      source: 'AUCTION_PAYMENT',
      delta: 3,
    },
    {
      method: 'penalizeAuctionPaymentTimeout' as const,
      score: 35,
      source: 'AUCTION_PAYMENT_TIMEOUT',
      delta: -30,
    },
  ])(
    'serializes a unique-phone profile PATCH with $method without a user/score deadlock',
    async ({ method, score, source, delta }) => {
      const id = await user({ score: 50 });
      const auctionId = randomUUID();
      let profileSaved!: () => void;
      const saved = new Promise<void>((resolve) => {
        profileSaved = resolve;
      });
      let continueProfile!: () => void;
      const proceed = new Promise<void>((resolve) => {
        continueProfile = resolve;
      });
      const gatedProfiles = new ProfileService(
        db.getRepository(ProfileUserEntity),
        db,
        { list: async () => [] } as never,
        {
          rewardProfileCompletion: async (
            userId: string,
            manager?: EntityManager,
          ) => {
            // Real PATCH has updated the unique phone and now holds the user FOR UPDATE lock.
            profileSaved();
            await proceed;
            return reputation.rewardProfileCompletion(userId, manager);
          },
        } as unknown as IdentityReputationService,
      );
      const patch = gatedProfiles.updateProfile(id, {
        phone: '0912345678',
        avatarUrl: 'https://example.com/a.png',
      });
      await saved;
      const auctionRunner = db.createQueryRunner();
      await auctionRunner.startTransaction();
      try {
        const [{ pid }] = await auctionRunner.query(
          'SELECT pg_backend_pid() AS pid',
        );
        const auction = reputation[method](
          id,
          auctionId,
          auctionRunner.manager,
        );
        // Observe actual PostgreSQL lock contention before allowing PATCH to request the score lock.
        // With the old score-first ordering the auction held score and waited for the user FK,
        // producing 40P01 as soon as the PATCH continued. Consistent user-first locking lets both commit.
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.query(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
            [pid],
          );
          if (rows[0]?.wait_event_type === 'Lock') {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        continueProfile();
        const results = await Promise.allSettled([patch, auction]);
        expect(blocked).toBe(true);
        expect(results.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
        await auctionRunner.commitTransaction();
      } finally {
        continueProfile();
        if (auctionRunner.isTransactionActive)
          await auctionRunner.rollbackTransaction();
        await auctionRunner.release();
        await patch.catch(() => undefined);
      }
      // Retries overlap too; the new profile claim and existing auction source stay consumed.
      await Promise.all([
        profiles.updateProfile(id, { fullName: 'Updated Test User' }),
        reputation[method](id, auctionId),
        reputation[method](id, auctionId),
      ]);
      const histories = await db.query<
        Array<{ source_type: string; delta: number }>
      >(
        'SELECT source_type,delta FROM identity.reputation_history WHERE user_id=$1 ORDER BY source_type',
        [id],
      );
      expect(histories).toEqual([
        { source_type: source, delta },
        { source_type: 'PROFILE_COMPLETION', delta: 15 },
      ]);
      expect(await count('identity.profile_completion_rewards')).toBe(1);
      expect(await count('identity.penalties')).toBe(
        method === 'penalizeAuctionPaymentTimeout' ? 1 : 0,
      );
      expect(
        (
          await db.query(
            'SELECT score FROM identity.reputation_scores WHERE user_id=$1',
            [id],
          )
        )[0].score,
      ).toBe(score);
      expect(
        (
          await db.query(
            'SELECT reputation_score,trust_level,is_restricted FROM auction.bidder_eligibility WHERE user_id=$1',
            [id],
          )
        )[0],
      ).toEqual({
        reputation_score: score,
        trust_level: score < 40 ? 'UNTRUSTED' : 'STANDARD',
        is_restricted: score < 50,
      });
      expect((await profiles.getProfile(id)).profileCompletionRewarded).toBe(
        true,
      );
    },
  );
  it.each([50, 98, 100])(
    'credits shop profile once under real concurrent transactions at %s',
    async (score) => {
      const s = await shop(score);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          reputation.rewardShopProfileCompletion(s.id),
        ),
      );
      expect(results.filter((r) => r && !r.alreadyRewarded)).toHaveLength(1);
      expect(await shopScore(s.id)).toBe(Math.min(100, score + 10));
      expect(
        (
          await db.query('SELECT delta FROM identity.shop_reputation_rewards')
        )[0].delta,
      ).toBe(Math.min(10, 100 - score));
      expect(await count('identity.reputation_scores')).toBe(0);
      expect(await count('identity.reputation_history')).toBe(0);
    },
  );
  it.each([
    { name: 'x' },
    { phone: '123' },
    { warehouseAddress: 'x' },
    { identityNumber: 'x' },
  ])(
    'does not mint shop points for invalid required fields %j',
    async (fields) => {
      const s = await shop(50, fields);
      expect(await reputation.rewardShopProfileCompletion(s.id)).toBeNull();
      expect(await count('identity.shop_reputation_rewards')).toBe(0);
    },
  );
  it('rolls a shop claim and score back and can retry', async () => {
    const s = await shop();
    await expect(
      db.transaction(async (m) => {
        await reputation.rewardShopProfileCompletion(s.id, m);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await shopScore(s.id)).toBe(50);
    expect(await count('identity.shop_reputation_rewards')).toBe(0);
    expect(await reputation.rewardShopProfileCompletion(s.id)).toMatchObject({
      newScore: 60,
    });
  });
  it('permits rejected dispute but defers pending and excludes accepted, cancelled, refunds and early orders', async () => {
    const s = await shop();
    for (const status of [
      'PENDING_STAFF_REVIEW',
      'ACCEPTED_REFUND',
      'REJECTED_PAY_SELLER',
    ]) {
      const id = await order(s.sellerId);
      await dispute(id, status);
      const result = await reputation.rewardCompletedOrder(id);
      if (status === 'REJECTED_PAY_SELLER')
        expect(result).toMatchObject({ newScore: 55 });
      else expect(result).toBeNull();
    }
    for (const status of ['REQUESTED', 'PROCESSING', 'COMPLETED']) {
      const id = await order(s.sellerId);
      await refund(id, status);
      expect(await reputation.rewardCompletedOrder(id)).toBeNull();
    }
    expect(
      await reputation.rewardCompletedOrder(
        await order(s.sellerId, 'CANCELLED'),
      ),
    ).toBeNull();
    expect(
      await reputation.rewardCompletedOrder(
        await order(s.sellerId, 'COMPLETED', 71),
      ),
    ).toBeNull();
    expect(await shopScore(s.id)).toBe(55);
  });
  it('uses latest delivery history and rejects exact complaint deadline inside one database transaction', async () => {
    const s = await shop();
    const id = await order(s.sellerId);
    await db.transaction(async (manager) => {
      await manager.query(
        "INSERT INTO commerce.order_status_history(order_id,to_status,created_at) VALUES ($1,'DELIVERED',NOW()-INTERVAL '72 hours')",
        [id],
      );
      expect(await reputation.rewardCompletedOrder(id, manager)).toBeNull();
      await manager.query(
        "UPDATE commerce.order_status_history SET created_at=created_at-INTERVAL '1 microsecond' WHERE order_id=$1",
        [id],
      );
      expect(await reputation.rewardCompletedOrder(id, manager)).toMatchObject({
        newScore: 55,
      });
    });
  });
  it('defers a pending dispute and rewards after a committed rejection, excluding refunded orders regardless fault', async () => {
    const s = await shop();
    const id = await order(s.sellerId);
    await dispute(id, 'PENDING_STAFF_REVIEW');
    expect(await reputation.rewardCompletedOrder(id)).toBeNull();
    await db.query(
      "UPDATE commerce.order_disputes SET status='REJECTED_PAY_SELLER' WHERE order_id=$1",
      [id],
    );
    expect(await reputation.rewardCompletedOrder(id)).toMatchObject({
      newScore: 55,
    });
    const rejectedRefund = await order(s.sellerId);
    await refund(rejectedRefund, 'REJECTED');
    expect(await reputation.rewardCompletedOrder(rejectedRefund)).toMatchObject(
      { newScore: 60 },
    );
  });
  it.each([50, 98, 100])(
    'serializes replay and distinct concurrent order rewards at score %s',
    async (score) => {
      const s = await shop(score);
      const ids = await Promise.all(
        Array.from({ length: 3 }, () => order(s.sellerId)),
      );
      await Promise.all(
        ids.flatMap((id) =>
          Array.from({ length: 3 }, () => reputation.rewardCompletedOrder(id)),
        ),
      );
      expect(await shopScore(s.id)).toBe(Math.min(100, score + 15));
      expect(await count('identity.shop_reputation_rewards')).toBe(3);
      expect(
        (
          await db.query(
            'SELECT SUM(delta)::int AS total FROM identity.shop_reputation_rewards',
          )
        )[0].total,
      ).toBe(Math.min(15, 100 - score));
    },
  );
  it('rolls order ledger and score back after a post-insert failure', async () => {
    const s = await shop();
    const id = await order(s.sellerId);
    await expect(
      db.transaction(async (m) => {
        await reputation.rewardCompletedOrder(id, m);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await shopScore(s.id)).toBe(50);
    expect(await count('identity.shop_reputation_rewards')).toBe(0);
  });
  it('bounds independent completed scan to 100 and drains past rewarded rows on retry', async () => {
    const s = await shop();
    for (let i = 0; i < 105; i++) await order(s.sellerId);
    const processor = new OrderCompletionProcessor(
      db,
      new OrderStateMachineService(),
      reputation,
    );
    expect(await processor.process({} as never)).toBe(0);
    expect(await count('identity.shop_reputation_rewards')).toBe(100);
    await processor.process({} as never);
    expect(await count('identity.shop_reputation_rewards')).toBe(105);
    await processor.process({} as never);
    expect(await count('identity.shop_reputation_rewards')).toBe(105);
  });

  it('allows overlapping job workers to drain distinct locked batches without duplicate ledger rows', async () => {
    const s = await shop();
    for (let i = 0; i < 105; i++) await order(s.sellerId);
    const processor = new OrderCompletionProcessor(
      db,
      new OrderStateMachineService(),
      reputation,
    );
    await Promise.all([
      processor.process({} as never),
      processor.process({} as never),
    ]);
    expect(await count('identity.shop_reputation_rewards')).toBe(105);
    expect(await shopScore(s.id)).toBe(100);
  });

  it('persists real delivered transitions, history and rewards together and retries idempotently', async () => {
    const s = await shop();
    const delivered = await order(s.sellerId, 'DELIVERED');
    const tooEarly = await order(s.sellerId, 'DELIVERED', 71);
    const completed = await order(s.sellerId);
    const processor = new OrderCompletionProcessor(
      db,
      new OrderStateMachineService(),
      reputation,
    );
    expect(await processor.process({} as never)).toBe(1);
    expect(
      await db.getRepository(OrderEntity).findOneByOrFail({ id: delivered }),
    ).toMatchObject({ status: 'COMPLETED' });
    const history = await db.getRepository(OrderStatusHistoryEntity).find({
      where: { orderId: delivered },
      order: { createdAt: 'ASC' },
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      fromStatus: 'DELIVERED',
      toStatus: 'COMPLETED',
      changedBy: null,
      reason: 'Automatically completed after the 72 hour complaint window',
    });
    expect(history[1].createdAt).toBeInstanceOf(Date);
    expect(await shopScore(s.id)).toBe(60);
    const claims = await db.query<Array<{ reference_id: string }>>(
      'SELECT reference_id FROM identity.shop_reputation_rewards ORDER BY reference_id',
    );
    expect(claims.map((row) => row.reference_id).sort()).toEqual(
      [delivered, completed].sort(),
    );
    expect(
      await db.query(
        'SELECT source_type, old_score, new_score, delta FROM identity.shop_reputation_rewards ORDER BY old_score',
      ),
    ).toEqual([
      {
        source_type: 'ORDER_COMPLETION',
        old_score: 50,
        new_score: 55,
        delta: 5,
      },
      {
        source_type: 'ORDER_COMPLETION',
        old_score: 55,
        new_score: 60,
        delta: 5,
      },
    ]);
    expect(await processor.process({} as never)).toBe(0);
    expect(await shopScore(s.id)).toBe(60);
    expect(await count('identity.shop_reputation_rewards')).toBe(2);
    expect(
      await db.getRepository(OrderStatusHistoryEntity).find({
        where: { orderId: delivered },
        order: { createdAt: 'ASC' },
      }),
    ).toEqual(history);
    expect(
      (
        await db.query('SELECT status FROM commerce.orders WHERE id=$1', [
          tooEarly,
        ])
      )[0].status,
    ).toBe('DELIVERED');
  });

  it('rolls real order, history, ledger and shop writes back on a database failure, then retries', async () => {
    const s = await shop();
    const delivered = await order(s.sellerId, 'DELIVERED');
    const orders = db.getRepository(OrderEntity);
    const histories = db.getRepository(OrderStatusHistoryEntity);
    const beforeOrder = await orders.findOneByOrFail({ id: delivered });
    const beforeHistory = await histories.findBy({ orderId: delivered });
    const processor = new OrderCompletionProcessor(
      db,
      new OrderStateMachineService(),
      reputation,
    );
    // Fail at the final shop UPDATE, after real order/history and ledger INSERTs.
    // The trigger performs the update before raising, so PostgreSQL must undo all four writes.
    await db.query(`
      CREATE FUNCTION identity.fail_completion_reward() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected shop reward database failure'; RETURN NEW; END;
      $$;
      CREATE TRIGGER fail_completion_reward AFTER UPDATE ON identity.shops
        FOR EACH ROW EXECUTE FUNCTION identity.fail_completion_reward();
    `);
    try {
      await expect(processor.process({} as never)).rejects.toThrow(
        'injected shop reward database failure',
      );
      expect(await orders.findOneByOrFail({ id: delivered })).toEqual(
        beforeOrder,
      );
      expect(await histories.findBy({ orderId: delivered })).toEqual(
        beforeHistory,
      );
      expect(await shopScore(s.id)).toBe(50);
      expect(await count('identity.shop_reputation_rewards')).toBe(0);
    } finally {
      await db.query(`
        DROP TRIGGER fail_completion_reward ON identity.shops;
        DROP FUNCTION identity.fail_completion_reward();
      `);
    }
    expect(await processor.process({} as never)).toBe(1);
    expect(await orders.findOneByOrFail({ id: delivered })).toMatchObject({
      status: 'COMPLETED',
    });
    expect(await histories.findBy({ orderId: delivered })).toHaveLength(2);
    expect(await shopScore(s.id)).toBe(55);
    expect(await count('identity.shop_reputation_rewards')).toBe(1);
    expect(await processor.process({} as never)).toBe(0);
    expect(await histories.findBy({ orderId: delivered })).toHaveLength(2);
    expect(await shopScore(s.id)).toBe(55);
    expect(await count('identity.shop_reputation_rewards')).toBe(1);
  });
});
