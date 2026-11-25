import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PreferredLanguage } from '../../domain/preferred-language.js';

@Entity({ name: 'users', schema: 'identity' })
export class ProfileUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 150, name: 'full_name' })
  fullName: string;

  @Column({
    type: 'varchar',
    length: 5,
    name: 'preferred_language',
    nullable: true,
  })
  preferredLanguage: PreferredLanguage | null;

  @Column({ type: 'varchar', length: 2048, nullable: true, name: 'avatar_url' })
  avatarUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true, name: 'deleted_at' })
  deletedAt: Date | null;
}
