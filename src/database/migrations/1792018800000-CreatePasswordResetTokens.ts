import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResetTokens1792018800000 implements MigrationInterface {
  name = 'CreatePasswordResetTokens1792018800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "identity"."password_reset_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_password_reset_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_password_reset_tokens_token_hash" ON "identity"."password_reset_tokens" ("token_hash")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_password_reset_tokens_user_active" ON "identity"."password_reset_tokens" ("user_id") WHERE "used_at" IS NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "identity"."password_reset_tokens"');
  }
}
