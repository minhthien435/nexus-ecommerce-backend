import { describe, expect, it } from 'vitest';
import { normalizeAmazonRow, stableExternalId } from './normalizer.js';

describe('Amazon dataset normalizer', () => {
  it('normalizes a valid product to VND without importing review fields', () => {
    const result = normalizeAmazonRow(
      {
        product_id: ' A1 ',
        product_name: ' Demo   Phone ',
        category: 'Electronics',
        discounted_price: '₹999.50',
        actual_price: '₹1,299.50',
        rating: '5',
        review_content: 'ignored',
        img_link: 'https://example.com/a.jpg',
      },
      2,
      'amazon',
      { Electronics: 'electronics' },
    );
    expect(result.product).toMatchObject({
      externalId: 'A1',
      name: 'Demo Phone',
      categorySlug: 'electronics',
      skus: [{ price: '999.50', currency: 'VND' }],
    });
    expect(result.product?.attributes).toEqual({});
  });
  it('reports unknown categories and bad prices deterministically', () => {
    const result = normalizeAmazonRow(
      { product_name: 'Bad', category: 'Other', actual_price: 'NaN' },
      5,
      'amazon',
      {},
    );
    expect(result.product).toBeUndefined();
    expect(result.issues.map((issue) => issue.errorCode)).toEqual([
      'CATEGORY_NOT_MAPPED',
      'INVALID_PRICE',
    ]);
  });
  it('uses a stable content hash rather than row order', () => {
    const first = stableExternalId({
      product_name: 'Phone',
      category: 'Tech',
      actual_price: '10',
    });
    expect(
      stableExternalId({
        actual_price: '999',
        category: 'Tech',
        product_name: 'Phone',
      }),
    ).toBe(first);
  });
  it('maps a category path through its top-level Amazon category', () => {
    const result = normalizeAmazonRow(
      {
        product_id: 'P-002',
        product_name: 'Cable',
        category: 'Computers&Accessories|Accessories&Peripherals|Cables',
        discounted_price: '₹399',
      },
      2,
      'amazon',
      { 'Computers&Accessories': 'computers-accessories' },
    );
    expect(result.product?.categorySlug).toBe('computers-accessories');
  });
});
