import * as argon2 from 'argon2';
import type { EntityManager } from 'typeorm';
import {
  PRIVILEGE_SEEDS,
  SYSTEM_ROLES,
} from '../../modules/identity/rbac/rbac.constants.js';

export type AdminSeedConfig = {
  email: string;
  password: string;
  fullName: string;
};

type UserSeedRow = { id: string; deleted_at: Date | null };

export async function seedSystemRolesAndPrivileges(
  manager: EntityManager,
): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await manager.query(
      `INSERT INTO identity.roles (code, name, description, is_system)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             is_system = true,
             deleted_at = NULL,
             updated_at = clock_timestamp()`,
      [role.code, role.name, role.description],
    );
  }

  for (const privilege of PRIVILEGE_SEEDS) {
    await manager.query(
      `INSERT INTO identity.privileges (code, module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE
         SET module = EXCLUDED.module,
             description = EXCLUDED.description`,
      [privilege.code, privilege.module, privilege.description],
    );

    for (const roleCode of privilege.roles) {
      await manager.query(
        `INSERT INTO identity.role_privileges (role_id, privilege_id)
         SELECT r.id, p.id
           FROM identity.roles r
           JOIN identity.privileges p ON p.code = $2
          WHERE r.code = $1 AND r.deleted_at IS NULL
         ON CONFLICT (role_id, privilege_id) DO NOTHING`,
        [roleCode, privilege.code],
      );
    }
  }
}

export async function seedInitialAdmin(
  manager: EntityManager,
  config: AdminSeedConfig,
): Promise<string> {
  const existingUsers = await manager.query<UserSeedRow[]>(
    `SELECT id, deleted_at
       FROM identity.users
      WHERE email = $1
      LIMIT 1`,
    [config.email],
  );

  let adminId: string;
  if (existingUsers.length > 0) {
    const existing = existingUsers[0];
    if (existing.deleted_at) {
      throw new Error('Admin seed email belongs to a deleted account');
    }
    adminId = existing.id;
  } else {
    const passwordHash = await argon2.hash(config.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
    });
    const inserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO identity.users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       RETURNING id`,
      [config.email, passwordHash, config.fullName],
    );
    adminId = inserted[0].id;
  }

  const result: { rowCount?: number } = await manager.query(
    `INSERT INTO identity.user_roles (user_id, role_id)
     SELECT $1, id
       FROM identity.roles
      WHERE code = 'ADMIN' AND deleted_at IS NULL
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [adminId],
  );
  if (result.rowCount === 0 && existingUsers.length === 0) {
    throw new Error('ADMIN role is missing; RBAC seed cannot be completed');
  }

  return adminId;
}

export async function seedRbac(
  manager: EntityManager,
  admin: AdminSeedConfig,
): Promise<void> {
  await seedSystemRolesAndPrivileges(manager);
  await seedInitialAdmin(manager, admin);
}
