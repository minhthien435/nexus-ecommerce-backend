/**
 * Utility functions for PayOS order code generation and validation.
 *
 * PayOS requires orderCode to be a positive integer <= 9007199254740991 (Number.MAX_SAFE_INTEGER).
 */

let counter = 0;

export function generatePayosOrderCode(): number {
  counter = (counter + 1) % 1000;
  // Date.now() is 13 digits (e.g. 1793584893952)
  // Multiplying by 1000 gives 16 digits (e.g. 1793584893952000)
  // Adding 3-digit counter gives monotonic safe integer well below Number.MAX_SAFE_INTEGER (9007199254740991)
  const code = Date.now() * 1000 + counter;
  return code;
}

export function isValidPayosOrderCode(code: unknown): code is number {
  return (
    typeof code === 'number' &&
    Number.isInteger(code) &&
    code > 0 &&
    code <= Number.MAX_SAFE_INTEGER
  );
}

export function formatPayosDescription(orderNumber: string): string {
  const cleanOrderNumber = orderNumber.trim();
  const desc = `Don hang ${cleanOrderNumber}`;
  // PayOS limit is 25 characters
  return desc.length <= 25 ? desc : desc.slice(0, 25);
}
