import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { UserEntity } from '../../domain/user.entity.js';
import { RoleEntity } from './role.entity.js';

@Entity({ schema: 'identity', name: 'user_roles' })
export class UserRoleEntity {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @PrimaryColumn('uuid', { name: 'role_id' })
  roleId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'assigned_at' })
  assignedAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<UserEntity>;

  @ManyToOne(() => RoleEntity, (role) => role.userRoles, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'role_id' })
  role: Relation<RoleEntity>;
}
