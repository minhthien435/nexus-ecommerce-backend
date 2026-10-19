import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'fulfillment', name: 'warehouses' })
export class WarehouseEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('boolean', { name: 'is_default' })
  isDefault: boolean;

  @Column('boolean', { name: 'is_active' })
  isActive: boolean;
}
