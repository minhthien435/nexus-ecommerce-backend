import { describe, expect, it, vi } from 'vitest';
import { AddBuyerBankInfoToOrderRefunds1794360000000 } from './1794360000000-AddBuyerBankInfoToOrderRefunds.js';

describe('AddBuyerBankInfoToOrderRefunds1794360000000', () => {
  it('adds buyer bank info columns in up()', async () => {
    const query = vi.fn();
    const migration = new AddBuyerBankInfoToOrderRefunds1794360000000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_bank_name" varchar(100) NULL',
    );
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_account_number" varchar(50) NULL',
    );
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" ADD COLUMN "buyer_account_holder_name" varchar(150) NULL',
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('drops buyer bank info columns in down()', async () => {
    const query = vi.fn();
    const migration = new AddBuyerBankInfoToOrderRefunds1794360000000();

    await migration.down({ query } as never);

    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_account_holder_name"',
    );
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_account_number"',
    );
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE "commerce"."order_refunds" DROP COLUMN IF EXISTS "buyer_bank_name"',
    );
    expect(query).toHaveBeenCalledTimes(3);
  });
});
