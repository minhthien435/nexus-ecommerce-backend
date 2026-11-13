import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AuctionBiddingCore1794370000000 implements MigrationInterface {
  name = 'AuctionBiddingCore1794370000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE "auction"."auctions" ADD COLUMN IF NOT EXISTS "reservation_receipt" jsonb',
    );
    await q.query(
      'ALTER TABLE "auction"."bids" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(200)',
    );
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bid_idempotency_dev2_1794370000000" ON "auction"."bids" ("auction_id", "bidder_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL',
    );
    await q.query(`ALTER TABLE "auction"."bidder_eligibility"
      ADD COLUMN IF NOT EXISTS "score" integer NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS "is_restricted" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "snapshotted_at" timestamptz NOT NULL DEFAULT now()`);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bidder_eligibility_auction_bidder" ON "auction"."bidder_eligibility" ("auction_id", "bidder_id")',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP INDEX IF EXISTS "auction"."UQ_bid_idempotency_dev2_1794370000000"',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" DROP COLUMN IF EXISTS "reservation_receipt"',
    );
  }
}
