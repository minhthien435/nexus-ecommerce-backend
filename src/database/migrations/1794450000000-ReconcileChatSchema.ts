import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconcileChatSchema1794450000000 implements MigrationInterface {
  name = 'ReconcileChatSchema1794450000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "chat"');

    // Reconcile chat.conversations against CreateChatSchema1794355200000 / ChatConversationEntity
    await queryRunner.query(`
      ALTER TABLE "chat"."conversations"
        DROP COLUMN IF EXISTS "last_message_type",
        ALTER COLUMN "last_message_at" DROP DEFAULT,
        ALTER COLUMN "last_message_at" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "chat"."conversations"
        DROP CONSTRAINT IF EXISTS "UQ_chat_buyer_shop"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'UQ_chat_conversations_buyer_shop'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "UQ_chat_conversations_buyer_shop" UNIQUE ("buyer_id", "shop_id");
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'CHK_chat_conversations_distinct'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "CHK_chat_conversations_distinct" CHECK ("buyer_id" <> "seller_id");
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'CHK_chat_conversations_unread'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "CHK_chat_conversations_unread" CHECK ("buyer_unread_count" >= 0 AND "seller_unread_count" >= 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'FK_chat_conversations_buyer'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "FK_chat_conversations_buyer" FOREIGN KEY ("buyer_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'FK_chat_conversations_seller'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "FK_chat_conversations_seller" FOREIGN KEY ("seller_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."conversations"'::regclass
            AND conname = 'FK_chat_conversations_shop'
        ) THEN
          ALTER TABLE "chat"."conversations"
            ADD CONSTRAINT "FK_chat_conversations_shop" FOREIGN KEY ("shop_id") REFERENCES "identity"."shops"("id") ON DELETE CASCADE;
        END IF;
      END $$
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "chat"."IDX_chat_conv_buyer"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "chat"."IDX_chat_conv_seller"',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_chat_conversations_buyer_recent" ON "chat"."conversations" ("buyer_id", "last_message_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_chat_conversations_seller_recent" ON "chat"."conversations" ("seller_id", "last_message_at" DESC)',
    );

    // Reconcile chat.messages against CreateChatSchema1794355200000 / ChatMessageEntity
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'chat' AND table_name = 'messages' AND column_name = 'content'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'chat' AND table_name = 'messages' AND column_name = 'text'
          ) THEN
            UPDATE "chat"."messages"
               SET "text" = COALESCE("text", "content")
             WHERE "text" IS NULL AND "content" IS NOT NULL;
            ALTER TABLE "chat"."messages" DROP COLUMN "content";
          ELSE
            ALTER TABLE "chat"."messages" RENAME COLUMN "content" TO "text";
          END IF;
        END IF;
      END $$
    `);
    await queryRunner.query(
      'ALTER TABLE "chat"."messages" ADD COLUMN IF NOT EXISTS "text" text',
    );
    await queryRunner.query(
      'ALTER TABLE "chat"."messages" ADD COLUMN IF NOT EXISTS "context" jsonb',
    );
    await queryRunner.query(`
      UPDATE "chat"."messages"
         SET "client_message_id" = "id"::varchar
       WHERE "client_message_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "chat"."messages"
        ALTER COLUMN "client_message_id" TYPE varchar(100),
        ALTER COLUMN "client_message_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "chat"."messages"
        DROP CONSTRAINT IF EXISTS "UQ_chat_sender_client_msg",
        DROP CONSTRAINT IF EXISTS "CHK_chat_messages_sender_role",
        DROP CONSTRAINT IF EXISTS "CHK_chat_messages_type"
    `);
    await queryRunner.query(`
      UPDATE "chat"."messages"
         SET "type" = CASE "type"
           WHEN 'PRODUCT_CARD' THEN 'PRODUCT'
           WHEN 'ORDER_CARD' THEN 'ORDER'
           ELSE "type"
         END
       WHERE "type" IN ('PRODUCT_CARD', 'ORDER_CARD')
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'UQ_chat_messages_sender_client'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "UQ_chat_messages_sender_client" UNIQUE ("sender_id", "client_message_id");
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'CHK_chat_messages_role'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "CHK_chat_messages_role" CHECK ("sender_role" IN ('BUYER','SELLER'));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'CHK_chat_messages_type'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "CHK_chat_messages_type" CHECK ("type" IN ('TEXT','IMAGE','PRODUCT','ORDER'));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'CHK_chat_messages_payload'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "CHK_chat_messages_payload" CHECK (("type"='TEXT' AND "text" IS NOT NULL) OR ("type"='IMAGE' AND "attachment" IS NOT NULL) OR ("type" IN ('PRODUCT','ORDER') AND "context" IS NOT NULL));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'FK_chat_messages_conversation'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"chat"."messages"'::regclass
            AND conname = 'FK_chat_messages_sender'
        ) THEN
          ALTER TABLE "chat"."messages"
            ADD CONSTRAINT "FK_chat_messages_sender" FOREIGN KEY ("sender_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE;
        END IF;
      END $$
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "chat"."IDX_chat_messages_conv_created"',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_chat_messages_conversation_cursor" ON "chat"."messages" ("conversation_id", "created_at" DESC, "id" DESC)',
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Non-destructive reconciliation migration; schema teardown belongs to CreateChatSchema1794355200000.
  }
}
