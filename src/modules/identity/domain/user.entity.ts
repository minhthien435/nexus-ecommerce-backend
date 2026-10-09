import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  DeleteDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'users', schema: 'identity' })
export class UserEntity {
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
    length: 50,
    nullable: true,
    name: 'identity_number',
  })
  identityNumber: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'date', nullable: true, name: 'date_of_birth' })
  dateOfBirth: Date | null;

  @Column({ type: 'varchar', name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', default: 'ACTIVE' })
  status: string;

  @Column({ type: 'integer', default: 0, name: 'failed_login_attempts' })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_until' })
  lockedUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_login_at' })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true, name: 'deleted_at' })
  deletedAt: Date | null;
}
