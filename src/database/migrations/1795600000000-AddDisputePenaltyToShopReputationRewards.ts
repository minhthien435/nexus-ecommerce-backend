import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisputePenaltyToShopReputationRewards1795600000000 implements MigrationInterface {
  name = 'AddDisputePenaltyToShopReputationRewards1795600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        ADD COLUMN IF NOT EXISTS reason varchar(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_source_type_check",
        DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_delta_check",
        DROP CONSTRAINT IF EXISTS "CK_shop_reward_reference"
    `);

    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        ADD CONSTRAINT "shop_reputation_rewards_source_type_check"
          CHECK (source_type IN ('ORDER_COMPLETION', 'SHOP_PROFILE_COMPLETION', 'DISPUTE_PENALTY')),
        ADD CONSTRAINT "shop_reputation_rewards_delta_check"
          CHECK (delta BETWEEN -10 AND 10),
        ADD CONSTRAINT "CK_shop_reward_reference"
          CHECK (
            (source_type = 'ORDER_COMPLETION' AND order_id IS NOT NULL AND reference_id = order_id AND delta BETWEEN 0 AND 5)
            OR (source_type = 'SHOP_PROFILE_COMPLETION' AND order_id IS NULL AND reference_id = shop_id AND delta BETWEEN 0 AND 10)
            OR (source_type = 'DISPUTE_PENALTY' AND order_id IS NOT NULL AND reference_id IS NOT NULL AND delta BETWEEN -10 AND -1)
          )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const existingPenalty = (await queryRunner.query(`
      SELECT 1 FROM identity.shop_reputation_rewards WHERE source_type = 'DISPUTE_PENALTY' LIMIT 1
    `)) as unknown[];

    if (existingPenalty && existingPenalty.length > 0) {
      throw new Error(
        'Cannot rollback AddDisputePenaltyToShopReputationRewards: DISPUTE_PENALTY records exist in identity.shop_reputation_rewards.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_source_type_check",
        DROP CONSTRAINT IF EXISTS "shop_reputation_rewards_delta_check",
        DROP CONSTRAINT IF EXISTS "CK_shop_reward_reference"
    `);

    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        ADD CONSTRAINT "shop_reputation_rewards_source_type_check"
          CHECK (source_type IN ('ORDER_COMPLETION', 'SHOP_PROFILE_COMPLETION')),
        ADD CONSTRAINT "shop_reputation_rewards_delta_check"
          CHECK (delta BETWEEN 0 AND 10),
        ADD CONSTRAINT "CK_shop_reward_reference"
          CHECK (
            (source_type = 'ORDER_COMPLETION' AND order_id IS NOT NULL AND reference_id = order_id AND delta <= 5)
            OR (source_type = 'SHOP_PROFILE_COMPLETION' AND order_id IS NULL AND reference_id = shop_id)
          )
    `);

    await queryRunner.query(`
      ALTER TABLE identity.shop_reputation_rewards
        DROP COLUMN IF EXISTS reason
    `);
  }
}
