import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'external_references', schema: 'integration' })
@Index(['sourceSystem', 'datasetName', 'entityType', 'externalId'], {
  unique: true,
})
export class ExternalReferenceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'source_system', type: 'varchar', length: 50 })
  sourceSystem: string;
  @Column({ name: 'dataset_name', type: 'varchar', length: 200 })
  datasetName: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType: string;
  @Column({ name: 'external_id', type: 'varchar', length: 300 })
  externalId: string;
  @Column({ name: 'internal_id', type: 'uuid' }) internalId: string;
  @CreateDateColumn({ name: 'imported_at', type: 'timestamptz' })
  importedAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
