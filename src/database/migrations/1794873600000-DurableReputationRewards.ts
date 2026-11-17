import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DurableReputationRewards1794873600000 implements MigrationInterface {
  name = 'DurableReputationRewards1794873600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A separate claim preserves all legacy audit rows, including duplicates.
    await queryRunner.query(`
      CREATE TABLE identity.profile_completion_rewards (
        user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await queryRunner.query(`
      INSERT INTO identity.profile_completion_rewards (user_id, created_at)
      SELECT user_id, MIN(created_at)
        FROM identity.reputation_history
       WHERE source_type = 'PROFILE_COMPLETION'
       GROUP BY user_id
      ON CONFLICT (user_id) DO NOTHING
    `);
    await queryRunner.query(`
      CREATE TABLE identity.shop_reputation_rewards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id uuid NOT NULL REFERENCES identity.shops(id) ON DELETE RESTRICT,
        source_type varchar(40) NOT NULL CHECK (source_type IN ('ORDER_COMPLETION', 'SHOP_PROFILE_COMPLETION')),
        reference_id uuid NOT NULL,
        order_id uuid REFERENCES commerce.orders(id) ON DELETE RESTRICT,
        old_score integer NOT NULL CHECK (old_score BETWEEN 0 AND 100),
        new_score integer NOT NULL CHECK (new_score BETWEEN 0 AND 100),
        delta integer NOT NULL CHECK (delta BETWEEN 0 AND 10),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "UQ_shop_reputation_reward" UNIQUE (shop_id, source_type, reference_id),
        CONSTRAINT "CK_shop_reputation_reward_delta" CHECK (new_score = old_score + delta),
        CONSTRAINT "UQ_shop_order_reward" UNIQUE (source_type, reference_id),
        CONSTRAINT "CK_shop_reward_reference" CHECK (
          (source_type = 'ORDER_COMPLETION' AND order_id IS NOT NULL AND reference_id = order_id AND delta <= 5)
          OR (source_type = 'SHOP_PROFILE_COMPLETION' AND order_id IS NULL AND reference_id = shop_id)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_order_delivered_reputation_clock"
      ON commerce.order_status_history (order_id, created_at DESC)
      WHERE to_status = 'DELIVERED'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX commerce."IDX_order_delivered_reputation_clock"',
    );
    await queryRunner.query('DROP TABLE identity.shop_reputation_rewards');
    await queryRunner.query('DROP TABLE identity.profile_completion_rewards');
  }
}
