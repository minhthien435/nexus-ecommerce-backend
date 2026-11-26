import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryNameVi1795650000000 implements MigrationInterface {
  name = 'AddCategoryNameVi1795650000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."categories"
        ADD COLUMN IF NOT EXISTS "name_vi" varchar(255) NULL
    `);

    await queryRunner.query(`
      UPDATE "catalog"."categories"
      SET "name_vi" = CASE "slug"
        WHEN 'electronics' THEN 'Điện tử'
        WHEN 'computers-accessories' THEN 'Máy tính & Phụ kiện'
        WHEN 'home-kitchen' THEN 'Nhà cửa & Bếp'
        WHEN 'office-products' THEN 'Văn phòng phẩm'
        WHEN 'home-improvement' THEN 'Sửa chữa & Cải tạo nhà'
        WHEN 'musical-instruments' THEN 'Nhạc cụ'
        WHEN 'car-motorbike' THEN 'Ô tô & Xe máy'
        WHEN 'health-personal-care' THEN 'Sức khỏe & Chăm sóc cá nhân'
        WHEN 'toys-games' THEN 'Đồ chơi & Trò chơi'
        WHEN 'smartphones' THEN 'Điện thoại thông minh'
        WHEN 'smartphones-1' THEN 'Điện thoại thông minh'
        WHEN 'charger' THEN 'Pin & Sạc'
        ELSE "name_vi"
      END
      WHERE "name_vi" IS NULL
        AND "slug" IN (
          'electronics',
          'computers-accessories',
          'home-kitchen',
          'office-products',
          'home-improvement',
          'musical-instruments',
          'car-motorbike',
          'health-personal-care',
          'toys-games',
          'smartphones',
          'smartphones-1',
          'charger'
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."categories"
        DROP COLUMN IF EXISTS "name_vi"
    `);
  }
}
