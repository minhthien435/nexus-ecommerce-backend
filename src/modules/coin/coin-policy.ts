export const COIN_POLICY = {
  vndPerCoin: 1,
  maxDiscountPercent: 30,
  minCashPayableVnd: 10_000,
};

export function coinDiscountCents(coins: number): bigint {
  return BigInt(coins) * BigInt(COIN_POLICY.vndPerCoin * 100);
}

export function coinLimit(subtotalCents: bigint, totalCents: bigint): number {
  const percentCap =
    (subtotalCents * BigInt(COIN_POLICY.maxDiscountPercent)) / 100n;
  const cashCap = totalCents - BigInt(COIN_POLICY.minCashPayableVnd * 100);
  const cap = percentCap < cashCap ? percentCap : cashCap;
  return cap > 0n ? Number(cap / coinDiscountCents(1)) : 0;
}
