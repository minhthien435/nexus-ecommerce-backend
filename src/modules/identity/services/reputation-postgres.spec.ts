import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, type EntityManager } from 'typeorm';
import type { OrderTransitionInput } from '../../commerce/services/order-state-machine.service.js';
import { DurableReputationRewards1794873600000 } from '../../../database/migrations/1794873600000-DurableReputationRewards.js';
import { ProfileUserEntity } from '../users/entities/profile-user.entity.js';
import { ProfileService } from '../users/profile/profile.service.js';
import { IdentityReputationService } from './identity-reputation.service.js';
import { OrderCompletionProcessor } from '../../commerce/processors/order-completion.processor.js';

// Opt-in only. Never import dotenv or silently fall back to the application DB.
const url = process.env.REPUTATION_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/nexus_reputation_test' ||
    target.search !== ''
  ) {
    throw new Error(
      'Reputation integration tests require a dedicated loopback nexus_reputation_test database',
    );
  }
}

describe.skipIf(!url)('durable reputation (isolated PostgreSQL)', () => {
  let db: DataSource;
  let reputation: IdentityReputationService;
  let profiles: ProfileService;
  let backfill: { claims: number; history: number };

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url,
      entities: [ProfileUserEntity],
      synchronize: false,
      extra: { max: 16 },
    });
    await db.initialize();
    // Schemas are disposable ONLY within the explicit dedicated target checked above.
    await db.query(
      'DROP SCHEMA IF EXISTS auction CASCADE; DROP SCHEMA IF EXISTS commerce CASCADE; DROP SCHEMA IF EXISTS identity CASCADE',
    );
    await db.query(`
      CREATE SCHEMA identity; CREATE SCHEMA commerce; CREATE SCHEMA auction;
      CREATE TABLE identity.users (id uuid PRIMARY KEY, email varchar UNIQUE NOT NULL, full_name varchar(150) NOT NULL,
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
      CREATE TABLE identity.shops (id uuid PRIMARY KEY, seller_id uuid REFERENCES identity.users(id), name varchar(150), phone varchar(30),
        warehouse_address text, identity_number varchar(100), reputation_score integer NOT NULL DEFAULT 50, deleted_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE UNIQUE INDEX shops_seller ON identity.shops(seller_id) WHERE deleted_at IS NULL;
      CREATE TABLE commerce.orders (id uuid PRIMARY KEY, seller_id uuid REFERENCES identity.users(id), status varchar, total numeric NOT NULL DEFAULT 100,
        delivered_at timestamptz);
      CREATE TABLE commerce.order_status_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES commerce.orders(id),
        to_status varchar, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE commerce.order_disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE REFERENCES commerce.orders(id), status varchar);
      CREATE TABLE commerce.order_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE REFERENCES commerce.orders(id), amount numeric, status varchar);
    `);
    const legacy = await user();
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
    backfill = {
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
    await db.query('TRUNCATE identity.users CASCADE');
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
      `INSERT INTO identity.users(id,email,full_name,phone,avatar_url) VALUES ($1,$2,$3,$4,$5)`,
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
      `INSERT INTO identity.shops(id,seller_id,name,phone,warehouse_address,identity_number,reputation_score)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        sellerId,
        fields.name ?? 'Valid shop',
        fields.phone ?? '0912345678',
        fields.warehouseAddress ?? 'Valid address',
        fields.identityNumber ?? '123456789',
        score,
      ],
    );
    return { id, sellerId };
  }
  async function order(sellerId: string, status = 'COMPLETED', hours = 73) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO commerce.orders(id,seller_id,status,delivered_at) VALUES ($1,$2,$3,NOW()-INTERVAL '100 hours')`,
      [id, sellerId, status],
    );
    await db.query(
      `INSERT INTO commerce.order_status_history(order_id,to_status,created_at) VALUES ($1,'DELIVERED',NOW()-$2*INTERVAL '1 hour')`,
      [id, hours],
    );
    return id;
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
    expect(backfill).toEqual({ claims: 1, history: 2 });
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
      await db.query(
        'INSERT INTO commerce.order_disputes(order_id,status) VALUES ($1,$2)',
        [id, status],
      );
      const result = await reputation.rewardCompletedOrder(id);
      if (status === 'REJECTED_PAY_SELLER')
        expect(result).toMatchObject({ newScore: 55 });
      else expect(result).toBeNull();
    }
    for (const status of ['REQUESTED', 'PROCESSING', 'COMPLETED']) {
      const id = await order(s.sellerId);
      await db.query(
        'INSERT INTO commerce.order_refunds(order_id,amount,status) VALUES ($1,100,$2)',
        [id, status],
      );
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
    await db.query(
      "INSERT INTO commerce.order_disputes(order_id,status) VALUES ($1,'PENDING_STAFF_REVIEW')",
      [id],
    );
    expect(await reputation.rewardCompletedOrder(id)).toBeNull();
    await db.query(
      "UPDATE commerce.order_disputes SET status='REJECTED_PAY_SELLER' WHERE order_id=$1",
      [id],
    );
    expect(await reputation.rewardCompletedOrder(id)).toMatchObject({
      newScore: 55,
    });
    const rejectedRefund = await order(s.sellerId);
    await db.query(
      "INSERT INTO commerce.order_refunds(order_id,amount,status) VALUES ($1,100,'REJECTED')",
      [rejectedRefund],
    );
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
      {
        transition: async () => {
          throw new Error('unexpected delivered');
        },
      } as never,
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
      {
        transition: async () => {
          throw new Error('unexpected delivered');
        },
      } as never,
      reputation,
    );
    await Promise.all([
      processor.process({} as never),
      processor.process({} as never),
    ]);
    expect(await count('identity.shop_reputation_rewards')).toBe(105);
    expect(await shopScore(s.id)).toBe(100);
  });

  it('preserves delivered completion work while rewarding due completed orders in the same job', async () => {
    const s = await shop();
    const delivered = await order(s.sellerId, 'DELIVERED');
    const tooEarly = await order(s.sellerId, 'DELIVERED', 71);
    const completed = await order(s.sellerId);
    const processor = new OrderCompletionProcessor(
      db,
      {
        transition: async (
          manager: EntityManager,
          input: OrderTransitionInput,
        ) => {
          await manager.query(
            'UPDATE commerce.orders SET status=$1 WHERE id=$2',
            [input.toStatus, input.orderId],
          );
        },
      } as never,
      reputation,
    );
    expect(await processor.process({} as never)).toBe(1);
    const claims = await db.query<Array<{ reference_id: string }>>(
      'SELECT reference_id FROM identity.shop_reputation_rewards ORDER BY reference_id',
    );
    expect(claims.map((row) => row.reference_id).sort()).toEqual(
      [delivered, completed].sort(),
    );
    expect(
      (
        await db.query('SELECT status FROM commerce.orders WHERE id=$1', [
          tooEarly,
        ])
      )[0].status,
    ).toBe('DELIVERED');
  });
});
