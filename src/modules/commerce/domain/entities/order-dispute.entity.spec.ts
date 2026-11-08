import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_REASON_CATEGORIES,
  OrderDisputeEntity,
} from './order-dispute.entity.js';
import { OrderEntity } from './order.entity.js';
import { CheckoutSessionEntity } from './checkout-session.entity.js';
import { OrderItemEntity } from './order-item.entity.js';

class MetadataDataSource extends DataSource {
  buildEntityMetadatas() {
    return this.buildMetadatas();
  }
}

describe('OrderDisputeEntity', () => {
  it('maps the commerce.order_disputes table metadata correctly', async () => {
    const dataSource = new MetadataDataSource({
      type: 'postgres',
      entities: [
        OrderDisputeEntity,
        OrderEntity,
        CheckoutSessionEntity,
        OrderItemEntity,
      ],
    });

    await dataSource.buildEntityMetadatas();
    const metadata = dataSource.getMetadata(OrderDisputeEntity);

    expect(metadata.schema).toBe('commerce');
    expect(metadata.tableName).toBe('order_disputes');

    const idCol = metadata.findColumnWithPropertyName('id');
    expect(idCol?.databaseName).toBe('id');
    expect(idCol?.isPrimary).toBe(true);

    const orderIdCol = metadata.findColumnWithPropertyName('orderId');
    expect(orderIdCol?.databaseName).toBe('order_id');
    const hasOrderUnique = metadata.uniques.some((u) =>
      u.columns.some((c) => c.databaseName === 'order_id'),
    );
    expect(hasOrderUnique).toBe(true);

    const buyerIdCol = metadata.findColumnWithPropertyName('buyerId');
    expect(buyerIdCol?.databaseName).toBe('buyer_id');

    const sellerIdCol = metadata.findColumnWithPropertyName('sellerId');
    expect(sellerIdCol?.databaseName).toBe('seller_id');

    const reasonCol = metadata.findColumnWithPropertyName('reasonCategory');
    expect(reasonCol?.databaseName).toBe('reason_category');

    const evidenceDescCol = metadata.findColumnWithPropertyName(
      'evidenceDescription',
    );
    expect(evidenceDescCol?.databaseName).toBe('evidence_description');

    const evidenceImagesCol =
      metadata.findColumnWithPropertyName('evidenceImages');
    expect(evidenceImagesCol?.databaseName).toBe('evidence_images');

    const statusCol = metadata.findColumnWithPropertyName('status');
    expect(statusCol?.databaseName).toBe('status');
    expect(statusCol?.default).toBe('PENDING_STAFF_REVIEW');

    const staffNoteCol =
      metadata.findColumnWithPropertyName('staffDecisionNote');
    expect(staffNoteCol?.databaseName).toBe('staff_decision_note');
    expect(staffNoteCol?.isNullable).toBe(true);

    const resolvedByCol = metadata.findColumnWithPropertyName('resolvedBy');
    expect(resolvedByCol?.databaseName).toBe('resolved_by');
    expect(resolvedByCol?.isNullable).toBe(true);

    const resolvedAtCol = metadata.findColumnWithPropertyName('resolvedAt');
    expect(resolvedAtCol?.databaseName).toBe('resolved_at');
    expect(resolvedAtCol?.isNullable).toBe(true);

    const createdAtCol = metadata.findColumnWithPropertyName('createdAt');
    expect(createdAtCol?.databaseName).toBe('created_at');

    const updatedAtCol = metadata.findColumnWithPropertyName('updatedAt');
    expect(updatedAtCol?.databaseName).toBe('updated_at');

    const orderRelation = metadata.findRelationWithPropertyPath('order');
    expect(orderRelation?.relationType).toBe('many-to-one');
    expect(orderRelation?.onDelete).toBe('RESTRICT');

    expect(DISPUTE_REASON_CATEGORIES).toEqual([
      'DAMAGED',
      'WRONG_ITEM',
      'COUNTERFEIT',
      'MISSING_PARTS',
      'NOT_AS_DESCRIBED',
      'OTHER',
    ]);
  });
});
