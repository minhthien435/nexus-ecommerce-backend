export const SUPPORTED_STRIPE_CURRENCIES = ['VND', 'USD', 'EUR'] as const;
export type SupportedStripeCurrency =
  (typeof SUPPORTED_STRIPE_CURRENCIES)[number];

const ZERO_DECIMAL_CURRENCIES = new Set<string>(['VND']);
const TWO_DECIMAL_CURRENCIES = new Set<string>(['USD', 'EUR']);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency?.trim().toUpperCase());
}

export function isSupportedStripeCurrency(
  currency: string,
): currency is SupportedStripeCurrency {
  const normalized = currency?.trim().toUpperCase();
  return (
    ZERO_DECIMAL_CURRENCIES.has(normalized) ||
    TWO_DECIMAL_CURRENCIES.has(normalized)
  );
}

/**
 * Converts a backend monetary amount (string or number) to Stripe's expected integer amount.
 * - For zero-decimal currencies like VND: "550000.00" -> 550000
 * - For two-decimal currencies like USD: "15.50" -> 1550
 *
 * Avoids floating-point multiplication by parsing the decimal string directly with BigInt.
 */
export function toStripeAmount(
  amount: string | number,
  currency: string,
): number {
  if (amount === null || amount === undefined) {
    throw new Error('Amount is required');
  }

  const normalizedCurrency = currency?.trim().toUpperCase();
  if (!normalizedCurrency || !isSupportedStripeCurrency(normalizedCurrency)) {
    throw new Error(`Unsupported Stripe currency: '${currency}'`);
  }

  const rawStr = typeof amount === 'number' ? amount.toString() : amount.trim();

  // Validate format: positive number with optional decimal point
  if (!/^\d+(?:\.\d+)?$/.test(rawStr)) {
    throw new Error(`Invalid monetary amount: '${rawStr}'`);
  }

  const [wholePart, fractionalPart = ''] = rawStr.split('.');

  const wholeBigInt = BigInt(wholePart);
  const fractionalBigInt = fractionalPart ? BigInt(fractionalPart) : 0n;
  if (wholeBigInt === 0n && fractionalBigInt === 0n) {
    throw new Error('Amount must be greater than zero');
  }

  if (isZeroDecimalCurrency(normalizedCurrency)) {
    // For zero-decimal currencies, any non-zero fractional digits are rejected
    if (fractionalPart && !/^0+$/.test(fractionalPart)) {
      throw new Error(
        `Zero-decimal currency '${normalizedCurrency}' does not support fractional units: '${rawStr}'`,
      );
    }

    if (wholeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Amount exceeds maximum safe integer limit: '${rawStr}'`);
    }

    const result = Number(wholeBigInt);
    if (!Number.isSafeInteger(result) || result <= 0) {
      throw new Error(`Invalid converted integer amount: ${result}`);
    }
    return result;
  }

  // Two-decimal currencies (USD, EUR)
  if (fractionalPart.length > 2) {
    throw new Error(
      `Currency '${normalizedCurrency}' supports at most 2 decimal places: '${rawStr}'`,
    );
  }

  const paddedFraction = fractionalPart.padEnd(2, '0');
  const centsBigInt = wholeBigInt * 100n + BigInt(paddedFraction);

  if (centsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Amount exceeds maximum safe integer limit: '${rawStr}'`);
  }

  const result = Number(centsBigInt);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`Invalid converted minor unit amount: ${result}`);
  }

  return result;
}

/**
 * Converts Stripe integer amount back to decimal string representation.
 * - VND: 550000 -> "550000.00"
 * - USD: 1550 -> "15.50"
 */
export function fromStripeAmount(
  stripeAmount: number,
  currency: string,
): string {
  if (!Number.isInteger(stripeAmount) || stripeAmount <= 0) {
    throw new Error(`Invalid Stripe integer amount: ${stripeAmount}`);
  }

  const normalizedCurrency = currency?.trim().toUpperCase();
  if (!normalizedCurrency || !isSupportedStripeCurrency(normalizedCurrency)) {
    throw new Error(`Unsupported Stripe currency: '${currency}'`);
  }

  if (isZeroDecimalCurrency(normalizedCurrency)) {
    return `${stripeAmount}.00`;
  }

  const whole = Math.floor(stripeAmount / 100);
  const fraction = (stripeAmount % 100).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}
