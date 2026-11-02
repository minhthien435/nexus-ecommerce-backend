import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { RefreshTokenEntity } from '../domain/refresh-token.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import type { UserStatus } from '../domain/user-status.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';
import { RoleEntity } from '../rbac/entities/role.entity.js';
import { AuditLogEntity } from '../domain/audit-log.entity.js';
import { IdentityOutboxEntity } from '../domain/identity-outbox.entity.js';
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
        '(user.full_name ILIKE :search OR user.email ILIKE :search OR user.phone ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.status) {
      builder.andWhere('user.status = :status', { status: query.status });
    }
    if (query.role) {
      builder.andWhere(
        (qb) => {
          const subQuery = qb
            .subQuery()
            .select('1')
            .from(UserRoleEntity, 'ur')
            .innerJoin(
              RoleEntity,
              'r',
              'r.id = ur.roleId AND r.code = :role AND r.deletedAt IS NULL',
            )
            .where('ur.userId = user.id')
            .getQuery();
          return `EXISTS ${subQuery}`;
        },
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
    const roles = (await this.loadRoleMap([user.id])).get(user.id) ?? [];
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
      await this.lockAdminChanges(manager);
      const user = await this.lockUser(manager, userId);
      await this.ensureNotLastAdmin(manager, userId, user.status);
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
      if (
        await manager
          .getRepository(UserRoleEntity)
          .exists({ where: { userId, roleId: role.id } })
      )
        return;
      await manager
        .getRepository(UserRoleEntity)
        .createQueryBuilder()
        .insert()
        .into(UserRoleEntity)
        .values({ userId, roleId: role.id })
        .orIgnore()
        .execute();
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
    if (
      actorId.toLowerCase() === userId.toLowerCase() &&
      roleCode === 'ADMIN'
    ) {
      throw new ConflictException('You cannot revoke your own ADMIN role');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.lockAdminChanges(manager);
      const user = await this.lockUser(manager, userId);
      const role = await this.findActiveRole(manager, roleCode);
      if (role.code === 'ADMIN')
        await this.ensureNotLastAdmin(manager, userId, user.status);
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

  async setStatus(
    actorId: string,
    userId: string,
    status: 'ACTIVE' | 'LOCKED',
    reason?: string,
  ): Promise<AdminUserView> {
    if (actorId.toLowerCase() === userId.toLowerCase() && status === 'LOCKED') {
      throw new ConflictException('You cannot lock your own account');
    }
    await this.changeStatus(actorId, userId, status, reason);
    return this.getById(userId);
  }

  async changeRoles(
    actorId: string,
    userId: string,
    assign: string[] = [],
    revoke: string[] = [],
  ): Promise<AdminUserView> {
    if (
      assign.length + revoke.length === 0 ||
      new Set([...assign, ...revoke]).size !== assign.length + revoke.length
    ) {
      throw new BadRequestException(
        'Role changes must be nonempty, unique and disjoint',
      );
    }
    if (
      actorId.toLowerCase() === userId.toLowerCase() &&
      revoke.includes('ADMIN')
    ) {
      throw new ConflictException('You cannot revoke your own ADMIN role');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.lockAdminChanges(manager);
      const user = await this.lockUser(manager, userId);
      const memberships = manager.getRepository(UserRoleEntity);
      for (const code of assign) {
        const role = await this.findActiveRole(manager, code);
        if (await memberships.exists({ where: { userId, roleId: role.id } }))
          continue;
        await memberships
          .createQueryBuilder()
          .insert()
          .into(UserRoleEntity)
          .values({ userId, roleId: role.id })
          .orIgnore()
          .execute();
        await this.recordChange(
          manager,
          actorId,
          userId,
          'USER_ROLE_ASSIGNED',
          { roleCode: code },
        );
      }
      for (const code of revoke) {
        const role = await this.findActiveRole(manager, code);
        if (code === 'ADMIN')
          await this.ensureNotLastAdmin(manager, userId, user.status);
        const result = await memberships.delete({ userId, roleId: role.id });
        if (result.affected !== 1)
          throw new NotFoundException('User role not found');
        await this.recordChange(manager, actorId, userId, 'USER_ROLE_REVOKED', {
          roleCode: code,
        });
      }
    });
    return this.getById(userId);
  }

  async resetPassword(
    actorId: string,
    userId: string,
    newPassword: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      if (
        user.passwordHash &&
        (await argon2.verify(user.passwordHash, newPassword))
      ) {
        throw new BadRequestException(
          'New password must be different from current password',
        );
      }
      user.passwordHash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });
      user.tokenVersion += 1;
      await manager.getRepository(UserEntity).save(user);
      await this.revokeSessions(manager, userId);
      await this.recordChange(
        manager,
        actorId,
        userId,
        'USER_PASSWORD_CHANGED',
        {},
      );
    });
  }

  private async changeStatus(
    actorId: string,
    userId: string,
    nextStatus: 'ACTIVE' | 'LOCKED',
    reason?: string,
  ): Promise<void> {
    if (
      actorId.toLowerCase() === userId.toLowerCase() &&
      nextStatus === 'LOCKED'
    ) {
      throw new ConflictException('You cannot lock your own account');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.lockAdminChanges(manager);
      const user = await this.lockUser(manager, userId);
      if (nextStatus === 'LOCKED') {
        if (user.status === 'SUSPENDED') {
          throw new ConflictException('Suspended users cannot be locked');
        }
        await this.ensureNotLastAdmin(manager, userId, user.status);
      } else if (user.status === 'SUSPENDED') {
        throw new ConflictException('Suspended users cannot be unlocked');
      }

      if (user.status === nextStatus && user.lockedUntil === null) return;
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
        {
          previousStatus,
          status: nextStatus,
          ...(reason !== undefined ? { reason } : {}),
        },
      );
    });
  }

  private async lockAdminChanges(manager: EntityManager): Promise<void> {
    // All admin-removal paths acquire this transaction-scoped lock BEFORE user
    // row locks, so concurrent removals cannot both observe two active admins.
    await manager.query('SELECT pg_advisory_xact_lock(16420, 1)');
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
    const role = await manager.getRepository(RoleEntity).findOne({
      where: { code: roleCode, deletedAt: IsNull() },
      select: { id: true, code: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    return { id: role.id, code: role.code };
  }

  private async ensureNotLastAdmin(
    manager: EntityManager,
    userId: string,
    status: UserStatus,
  ): Promise<void> {
    if (status !== 'ACTIVE') return;
    const adminRole = await manager.getRepository(RoleEntity).findOne({
      where: { code: 'ADMIN', deletedAt: IsNull() },
      select: { id: true },
    });
    if (!adminRole) return;

    const isUserAdmin = await manager.getRepository(UserRoleEntity).exists({
      where: { userId, roleId: adminRole.id },
    });

    if (isUserAdmin) {
      const activeAdminsCount = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .innerJoin(UserRoleEntity, 'ur', 'ur.userId = u.id')
        .where('ur.roleId = :roleId', { roleId: adminRole.id })
        .andWhere('u.deletedAt IS NULL')
        .andWhere('u.status = :status', { status: 'ACTIVE' })
        .getCount();

      if (activeAdminsCount <= 1) {
        throw new ConflictException(
          'The last active administrator is protected',
        );
      }
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

    const auditRepo = manager.getRepository(AuditLogEntity);
    const auditRecord = auditRepo.create({
      actorId,
      action,
      entityType: 'USER',
      entityId: userId,
      changes,
    });
    await auditRepo.save(auditRecord);

    const outboxRepo = manager.getRepository(IdentityOutboxEntity);
    const outboxRecord = outboxRepo.create({
      eventType: action,
      aggregateType: 'USER',
      aggregateId: userId,
      payload,
    });
    await outboxRepo.save(outboxRecord);
  }

  private async loadRoleMap(userIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;

    const rows = await this.dataSource
      .getRepository(UserRoleEntity)
      .createQueryBuilder('ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.roleId AND r.deletedAt IS NULL')
      .select('ur.userId', 'user_id')
      .addSelect('r.code', 'code')
      .where('ur.userId IN (:...userIds)', { userIds })
      .orderBy('r.code', 'ASC')
      .getRawMany<{ user_id: string; code: string }>();

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
