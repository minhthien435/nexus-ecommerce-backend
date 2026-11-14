import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AuctionBiddingCore1794370000000 implements MigrationInterface {
  name = 'AuctionBiddingCore1794370000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE "auction"."auctions" ADD COLUMN IF NOT EXISTS "reservation_receipt" jsonb',
    );
    await q.query(
      `DO $$
       DECLARE constraint_name text;
       BEGIN
         SELECT unique_constraint.conname INTO constraint_name
         FROM pg_constraint AS unique_constraint
         JOIN pg_class AS table_ref ON table_ref.oid = unique_constraint.conrelid
         JOIN pg_namespace AS schema_ref ON schema_ref.oid = table_ref.relnamespace
         WHERE schema_ref.nspname = 'auction'
           AND table_ref.relname = 'bids'
           AND unique_constraint.contype = 'u'
           AND unique_constraint.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
              WHERE attrelid = table_ref.oid AND attname = 'idempotency_key')
           ]::smallint[]
         LIMIT 1;
         IF constraint_name IS NOT NULL THEN
           EXECUTE format('ALTER TABLE auction.bids DROP CONSTRAINT %I', constraint_name);
         END IF;
       END $$`,
    );
    await q.query(
      'ALTER TABLE "auction"."bids" ALTER COLUMN "idempotency_key" TYPE varchar(200)',
    );
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bid_idempotency_dev2_1794370000000" ON "auction"."bids" ("auction_id", "bidder_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP INDEX IF EXISTS "auction"."UQ_bid_idempotency_dev2_1794370000000"',
    );
    await q.query(
      'ALTER TABLE "auction"."bids" ALTER COLUMN "idempotency_key" TYPE varchar(100)',
    );
    await q.query(
      'ALTER TABLE "auction"."bids" ADD CONSTRAINT "bids_idempotency_key_key" UNIQUE ("idempotency_key")',
    );
    await q.query(
      'ALTER TABLE "auction"."auctions" DROP COLUMN IF EXISTS "reservation_receipt"',
    );
  }
}
