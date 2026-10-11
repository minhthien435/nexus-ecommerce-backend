import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { RefreshTokenEntity } from '../domain/refresh-token.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import type { UserStatus } from '../domain/user-status.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { ListUsersQueryDto } from './dtos/list-users-query.dto.js';

export type AdminUserView = {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  identityNumber: string | null;
  gender: string | null;
  address: string | null;
  dateOfBirth: Date | null;
  status: UserStatus;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type UserPage = {
  items: AdminUserView[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: ListUsersQueryDto): Promise<UserPage> {
    const builder = this.users
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.phone',
        'user.fullName',
        'user.identityNumber',
        'user.gender',
        'user.address',
        'user.dateOfBirth',
        'user.status',
        'user.createdAt',
        'user.updatedAt',
      ])
      .where('user.deleted_at IS NULL');

    if (query.search) {
      builder.andWhere(
        '(user.full_name ILIKE :search OR user.email::text ILIKE :search OR user.phone ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.status) {
      builder.andWhere('user.status = :status', { status: query.status });
    }
    if (query.role) {
      builder.andWhere(
        `EXISTS (
           SELECT 1
             FROM identity.user_roles ur
             JOIN identity.roles r ON r.id = ur.role_id
            WHERE ur.user_id = user.id
              AND r.code = :role
              AND r.deleted_at IS NULL
         )`,
        { role: query.role },
      );
    }

    const sortColumns = {
      fullName: 'user.full_name',
      email: 'user.email',
      createdAt: 'user.created_at',
      status: 'user.status',
    } as const;
    builder
      .orderBy(sortColumns[query.sortBy], query.sortOrder)
      .addOrderBy('user.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [records, total] = await builder.getManyAndCount();
    const roleMap = await this.loadRoleMap(records.map(({ id }) => id));
    return {
      items: records.map((user) =>
        this.toView(user, roleMap.get(user.id) ?? []),
      ),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getById(userId: string): Promise<AdminUserView> {
    const user = await this.users.findOne({
      where: { id: userId, deletedAt: IsNull() },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        identityNumber: true,
        gender: true,
        address: true,
        dateOfBirth: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const roles = (await this.loadRoleMap([userId])).get(userId) ?? [];
    return this.toView(user, roles);
  }

  async lock(actorId: string, userId: string): Promise<AdminUserView> {
    await this.changeStatus(actorId, userId, 'LOCKED');
    return this.getById(userId);
  }

  async unlock(actorId: string, userId: string): Promise<AdminUserView> {
    await this.changeStatus(actorId, userId, 'ACTIVE');
    return this.getById(userId);
  }

  async softDelete(actorId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      await this.ensureNotLastAdmin(manager, userId);
      user.deletedAt = new Date();
      user.tokenVersion += 1;
      await manager.getRepository(UserEntity).save(user);
      await this.revokeSessions(manager, userId);
      await this.recordChange(manager, actorId, userId, 'USER_DELETED', {
        deletedAt: user.deletedAt.toISOString(),
      });
    });
  }

  async assignRole(
    actorId: string,
    userId: string,
    roleCode: string,
  ): Promise<AdminUserView> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockUser(manager, userId);
      const role = await this.findActiveRole(manager, roleCode);
      await manager.query(
        `INSERT INTO identity.user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, role.id],
      );
      await this.recordChange(manager, actorId, userId, 'USER_ROLE_ASSIGNED', {
        roleCode: role.code,
      });
    });
    return this.getById(userId);
  }

  async revokeRole(
    actorId: string,
    userId: string,
    roleCode: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockUser(manager, userId);
      const role = await this.findActiveRole(manager, roleCode);
      if (role.code === 'ADMIN') await this.ensureNotLastAdmin(manager, userId);
      const result = await manager
        .getRepository(UserRoleEntity)
        .delete({ userId, roleId: role.id });
      if (result.affected !== 1)
        throw new NotFoundException('User role not found');
      await this.recordChange(manager, actorId, userId, 'USER_ROLE_REVOKED', {
        roleCode: role.code,
      });
    });
  }

  private async changeStatus(
    actorId: string,
    userId: string,
    nextStatus: 'ACTIVE' | 'LOCKED',
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      if (nextStatus === 'LOCKED') {
        if (user.status === 'SUSPENDED') {
          throw new ConflictException('Suspended users cannot be locked');
        }
        await this.ensureNotLastAdmin(manager, userId);
      } else if (user.status === 'SUSPENDED') {
        throw new ConflictException('Suspended users cannot be unlocked');
      }

      if (user.status === nextStatus) return;
      const previousStatus = user.status;
      user.status = nextStatus;
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.tokenVersion += 1;
      await manager.getRepository(UserEntity).save(user);
      await this.revokeSessions(manager, userId);
      await this.recordChange(
        manager,
        actorId,
        userId,
        nextStatus === 'LOCKED' ? 'USER_LOCKED' : 'USER_UNLOCKED',
        { previousStatus, status: nextStatus },
      );
    });
  }

  private async lockUser(
    manager: EntityManager,
    userId: string,
  ): Promise<UserEntity> {
    const user = await manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .andWhere('user.deleted_at IS NULL')
      .getOne();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async findActiveRole(
    manager: EntityManager,
    roleCode: string,
  ): Promise<{ id: string; code: string }> {
    const roles = await manager.query<Array<{ id: string; code: string }>>(
      `SELECT id, code
         FROM identity.roles
        WHERE code = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [roleCode],
    );
    if (roles.length === 0) throw new NotFoundException('Role not found');
    return roles[0];
  }

  private async ensureNotLastAdmin(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const rows = await manager.query<
      Array<{ is_admin: boolean; active_admins: string }>
    >(
      `SELECT
         EXISTS (
           SELECT 1
             FROM identity.user_roles ur
             JOIN identity.roles r ON r.id = ur.role_id
            WHERE ur.user_id = $1 AND r.code = 'ADMIN' AND r.deleted_at IS NULL
         ) AS is_admin,
         (
           SELECT COUNT(DISTINCT u.id)::text
             FROM identity.users u
             JOIN identity.user_roles ur ON ur.user_id = u.id
             JOIN identity.roles r ON r.id = ur.role_id
            WHERE r.code = 'ADMIN'
              AND r.deleted_at IS NULL
              AND u.deleted_at IS NULL
              AND u.status = 'ACTIVE'
         ) AS active_admins`,
      [userId],
    );
    if (rows[0]?.is_admin && Number(rows[0].active_admins) <= 1) {
      throw new ConflictException('The last active administrator is protected');
    }
  }

  private revokeSessions(
    manager: EntityManager,
    userId: string,
  ): Promise<unknown> {
    return manager
      .getRepository(RefreshTokenEntity)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async recordChange(
    manager: EntityManager,
    actorId: string,
    userId: string,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const payload = { actorId, userId, action, changes };
    await manager.query(
      `INSERT INTO identity.audit_logs
         (actor_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, 'USER', $3, $4::jsonb)`,
      [actorId, action, userId, JSON.stringify(changes)],
    );
    await manager.query(
      `INSERT INTO identity.outbox_events
         (event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'USER', $2, $3::jsonb)`,
      [action, userId, JSON.stringify(payload)],
    );
  }

  private async loadRoleMap(userIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    const rows = await this.dataSource.query<
      Array<{ user_id: string; code: string }>
    >(
      `SELECT ur.user_id, r.code
         FROM identity.user_roles ur
         JOIN identity.roles r ON r.id = ur.role_id
        WHERE ur.user_id = ANY($1::uuid[])
          AND r.deleted_at IS NULL
        ORDER BY r.code`,
      [userIds],
    );
    for (const row of rows) {
      map.set(row.user_id, [...(map.get(row.user_id) ?? []), row.code]);
    }
    return map;
  }

  private toView(user: UserEntity, roles: string[]): AdminUserView {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      identityNumber: user.identityNumber,
      gender: user.gender,
      address: user.address,
      dateOfBirth: user.dateOfBirth,
      status: user.status,
      roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
