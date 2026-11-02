import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowCancelledStatusInCheckoutSessions1793050000000 implements MigrationInterface {
  name = 'AllowCancelledStatusInCheckoutSessions1793050000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE commerce.checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check',
    );
    await queryRunner.query(
      "ALTER TABLE commerce.checkout_sessions ADD CONSTRAINT checkout_sessions_status_check CHECK (status IN ('INITIATED', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED'))",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE commerce.checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check',
    );
    await queryRunner.query(
      "ALTER TABLE commerce.checkout_sessions ADD CONSTRAINT checkout_sessions_status_check CHECK (status IN ('INITIATED', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED'))",
    );
  }
}
