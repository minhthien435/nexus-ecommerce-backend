// PostgreSQL numeric(18,2) stays a string until converted to integer cents.
export function moneyToCents(value: string): bigint {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Invalid numeric(18,2) money value');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function centsToMoney(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
