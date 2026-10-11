import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRoleEntity } from './entities/user-role.entity.js';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(UserRoleEntity)
    private readonly userRoles: Repository<UserRoleEntity>,
  ) {}

  async getRoles(userId: string): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoin('userRole.role', 'role', 'role.deleted_at IS NULL')
      .select('role.code', 'code')
      .where('userRole.user_id = :userId', { userId })
      .orderBy('role.code', 'ASC')
      .getRawMany<{ code: string }>();
    return rows.map(({ code }) => code);
  }

  async getPermissions(userId: string): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoin('userRole.role', 'role', 'role.deleted_at IS NULL')
      .innerJoin('role.rolePrivileges', 'rolePrivilege')
      .innerJoin('rolePrivilege.privilege', 'privilege')
      .select('DISTINCT privilege.code', 'code')
      .where('userRole.user_id = :userId', { userId })
      .orderBy('privilege.code', 'ASC')
      .getRawMany<{ code: string }>();
    return rows.map(({ code }) => code);
  }

  async hasAnyRole(
    userId: string,
    required: readonly string[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const roles = await this.getRoles(userId);
    return required.some((role) => roles.includes(role));
  }

  async hasAllPermissions(
    userId: string,
    required: readonly string[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const permissions = await this.getPermissions(userId);
    return required.every((permission) => permissions.includes(permission));
  }
}
