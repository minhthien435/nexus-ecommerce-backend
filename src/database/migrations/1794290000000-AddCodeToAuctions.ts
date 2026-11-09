import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCodeToAuctions1794290000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE auction.auctions ADD COLUMN code varchar(50)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_auction_code" ON auction.auctions (code) WHERE code IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS auction."UQ_auction_code"');
    await queryRunner.query(
      'ALTER TABLE auction.auctions DROP COLUMN IF EXISTS code',
    );
  }
}
