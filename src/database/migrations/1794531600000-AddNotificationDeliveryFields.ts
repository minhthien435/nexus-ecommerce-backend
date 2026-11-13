import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationDeliveryFields1794531600000 implements MigrationInterface {
  name = 'AddNotificationDeliveryFields1794531600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification"."notifications"
        ADD COLUMN IF NOT EXISTS "action_url" text,
        ADD COLUMN IF NOT EXISTS "metadata" jsonb
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_channel_created"
        ON "notification"."notifications" ("user_id", "channel", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
        ON "notification"."notifications" ("user_id", "channel")
        WHERE "read_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_source_event_dedup"
        ON "notification"."notifications"
          ("user_id", "source_event_id", "notification_type", "channel")
        WHERE "source_event_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_preferences_user_type_channel"
        ON "notification"."notification_preferences"
          ("user_id", "notification_type", "channel")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "notification"."uq_notification_preferences_user_type_channel"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "notification"."uq_notifications_source_event_dedup"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "notification"."idx_notifications_user_unread"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "notification"."idx_notifications_user_channel_created"',
    );
    await queryRunner.query(`
      ALTER TABLE "notification"."notifications"
        DROP COLUMN IF EXISTS "metadata",
        DROP COLUMN IF EXISTS "action_url"
    `);
  }
}
