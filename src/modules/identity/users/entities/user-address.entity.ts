import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'identity', name: 'user_addresses' })
export class UserAddressEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('varchar', { name: 'recipient_name', length: 150 })
  recipientName: string;

  @Column('varchar', { name: 'phone', length: 30 })
  recipientPhone: string;

  @Column('text', { name: 'address_line' })
  addressLine: string;

  @Column('varchar', { name: 'province_code', length: 50, nullable: true })
  provinceCode: string | null;

  @Column('varchar', { name: 'district_code', length: 50, nullable: true })
  districtCode: string | null;

  @Column('varchar', { name: 'ward_code', length: 50, nullable: true })
  wardCode: string | null;

  @Column('varchar', { name: 'address_scheme', length: 20, default: 'legacy' })
  addressScheme: 'legacy' | 'ghn_v3';

  @Column('varchar', { name: 'province_name', length: 150, nullable: true })
  provinceName: string | null;

  @Column('varchar', { name: 'ward_name', length: 150, nullable: true })
  wardName: string | null;

  @Column('boolean', { name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
  })
  updatedAt: Date;
}
