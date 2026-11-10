import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatSchema1794355200000 implements MigrationInterface {
  name = 'CreateChatSchema1794355200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "chat"');
    await queryRunner.query(`CREATE TABLE "chat"."conversations" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "buyer_id" uuid NOT NULL, "seller_id" uuid NOT NULL,
      "shop_id" uuid NOT NULL, "buyer_unread_count" integer NOT NULL DEFAULT 0, "seller_unread_count" integer NOT NULL DEFAULT 0,
      "last_message_preview" varchar(255), "last_message_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_chat_conversations" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_chat_conversations_buyer_shop" UNIQUE ("buyer_id", "shop_id"),
      CONSTRAINT "CHK_chat_conversations_distinct" CHECK ("buyer_id" <> "seller_id"),
      CONSTRAINT "CHK_chat_conversations_unread" CHECK ("buyer_unread_count" >= 0 AND "seller_unread_count" >= 0),
      CONSTRAINT "FK_chat_conversations_buyer" FOREIGN KEY ("buyer_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_chat_conversations_seller" FOREIGN KEY ("seller_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_chat_conversations_shop" FOREIGN KEY ("shop_id") REFERENCES "identity"."shops"("id") ON DELETE CASCADE)`);
    await queryRunner.query(`CREATE TABLE "chat"."messages" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "sender_id" uuid NOT NULL,
      "sender_role" varchar(10) NOT NULL, "type" varchar(20) NOT NULL, "client_message_id" varchar(100) NOT NULL,
      "text" text, "attachment" jsonb, "context" jsonb, "read_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"), CONSTRAINT "UQ_chat_messages_sender_client" UNIQUE ("sender_id", "client_message_id"),
      CONSTRAINT "CHK_chat_messages_role" CHECK ("sender_role" IN ('BUYER','SELLER')),
      CONSTRAINT "CHK_chat_messages_type" CHECK ("type" IN ('TEXT','IMAGE','PRODUCT','ORDER')),
      CONSTRAINT "CHK_chat_messages_payload" CHECK (("type"='TEXT' AND "text" IS NOT NULL) OR ("type"='IMAGE' AND "attachment" IS NOT NULL) OR ("type" IN ('PRODUCT','ORDER') AND "context" IS NOT NULL)),
      CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_chat_messages_sender" FOREIGN KEY ("sender_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE)`);
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_messages_conversation_cursor" ON "chat"."messages" ("conversation_id", "created_at" DESC, "id" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_conversations_buyer_recent" ON "chat"."conversations" ("buyer_id", "last_message_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_conversations_seller_recent" ON "chat"."conversations" ("seller_id", "last_message_at" DESC)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "chat"."messages"');
    await queryRunner.query('DROP TABLE IF EXISTS "chat"."conversations"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "chat"');
  }
}
