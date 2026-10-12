import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { PrivilegeEntity } from './privilege.entity.js';
import { RoleEntity } from './role.entity.js';

@Entity({ schema: 'identity', name: 'role_privileges' })
export class RolePrivilegeEntity {
  @PrimaryColumn('uuid', { name: 'role_id' })
  roleId: string;

  @PrimaryColumn('uuid', { name: 'privilege_id' })
  privilegeId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => RoleEntity, (role) => role.rolePrivileges, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'role_id' })
  role: Relation<RoleEntity>;

  @ManyToOne(() => PrivilegeEntity, (privilege) => privilege.rolePrivileges, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({ name: 'privilege_id' })
  privilege: Relation<PrivilegeEntity>;
}
