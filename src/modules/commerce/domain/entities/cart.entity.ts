import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'commerce', name: 'carts' })
export class CartEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: true })
  userId: string | null;

  @Column('varchar', { name: 'guest_token', length: 100, nullable: true })
  guestToken: string | null;

  @Column('varchar', { length: 30, default: 'ACTIVE' })
  status: string;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
