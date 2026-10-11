import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RolePrivilegeEntity } from './role-privilege.entity.js';

@Entity({ schema: 'identity', name: 'privileges' })
export class PrivilegeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  code: string;

  @Column({ type: 'varchar' })
  module: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(
    () => RolePrivilegeEntity,
    (rolePrivilege) => rolePrivilege.privilege,
  )
  rolePrivileges: RolePrivilegeEntity[];
}
