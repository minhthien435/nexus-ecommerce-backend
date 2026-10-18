import { describe, expect, it, vi } from 'vitest';
import { HardenProductSkuConstraints1792195200000 } from './1792195200000-HardenProductSkuConstraints.js';

describe('HardenProductSkuConstraints migration', () => {
  it('preflights legacy rows before tightening SKU constraints', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new HardenProductSkuConstraints1792195200000().up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => statement as string);
    expect(sql).toHaveLength(6);
    expect(sql[0]).toContain('RAISE EXCEPTION');
    expect(sql[0]).toContain('"weight_grams" <= 0');
    expect(sql[0]).toContain('"length_cm" IS NULL');
    expect(sql[1]).toContain('ALTER COLUMN "variant_attributes" SET NOT NULL');
    expect(sql[1]).toContain('ALTER COLUMN "weight_grams" DROP DEFAULT');
    expect(sql[1]).toContain(
      'ALTER COLUMN "currency" TYPE character varying(3)',
    );
    expect(sql[2]).toContain('is_valid_sku_attributes');
    expect(sql[3]).toContain('CHECK ("weight_grams" > 0)');
    expect(sql[3]).toContain('CHECK (char_length(btrim("currency")) = 3)');
    expect(sql[4]).toContain('IDX_product_skus_product_id');
    expect(sql[5]).toContain('CREATE UNIQUE INDEX');
    expect(sql[5]).toContain('("product_id", "variant_attributes")');
  });

  it('restores the prior permissive checks on rollback', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new HardenProductSkuConstraints1792195200000().down({
      query,
    } as never);

    const sql = query.mock.calls.map(([statement]) => statement as string);
    expect(sql).toHaveLength(5);
    expect(sql[0]).toContain('UQ_product_skus_product_variant_attributes');
    expect(sql[1]).toContain('IDX_product_skus_product_id');
    expect(sql[2]).toContain('CHECK ("weight_grams" >= 0)');
    expect(sql[3]).toContain('ALTER COLUMN "length_cm" DROP NOT NULL');
    expect(sql[3]).toContain('ALTER COLUMN "weight_grams" SET DEFAULT 0');
    expect(sql[3]).toContain('ALTER COLUMN "currency" TYPE character(3)');
    expect(sql[3]).toContain(
      'ALTER COLUMN "currency" SET DEFAULT \'VND\'::bpchar',
    );
    expect(sql[4]).toContain('DROP FUNCTION IF EXISTS');
  });
});
