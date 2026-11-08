import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateSupportStaffRole1794189600000 implements MigrationInterface {
  name = 'MigrateSupportStaffRole1794189600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO identity.roles (code, name, description, is_system)
      VALUES ('STAFF', 'Support Staff', 'Customer support staff', true)
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            is_system = true,
            deleted_at = NULL,
            updated_at = clock_timestamp()
    `);
    await queryRunner.query(`
      INSERT INTO identity.user_roles (user_id, role_id)
      SELECT membership.user_id, canonical.id
        FROM identity.user_roles membership
        JOIN identity.roles legacy ON legacy.id = membership.role_id
        CROSS JOIN identity.roles canonical
       WHERE legacy.code = 'SUPPORT_STAFF'
         AND canonical.code = 'STAFF'
         AND canonical.deleted_at IS NULL
      ON CONFLICT (user_id, role_id) DO NOTHING
    `);
    await queryRunner.query(`
      DELETE FROM identity.user_roles membership
       USING identity.roles legacy
       WHERE membership.role_id = legacy.id
         AND legacy.code = 'SUPPORT_STAFF'
    `);
    await queryRunner.query(`
      DELETE FROM identity.role_privileges assignment
       USING identity.roles legacy
       WHERE assignment.role_id = legacy.id
         AND legacy.code = 'SUPPORT_STAFF'
    `);
    await queryRunner.query(
      `DELETE FROM identity.roles WHERE code = 'SUPPORT_STAFF'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO identity.roles (code, name, description, is_system)
      VALUES ('SUPPORT_STAFF', 'Legacy Support Staff', 'Retired support role', false)
      ON CONFLICT (code) DO NOTHING
    `);
  }
}
