import { describe, expect, it } from 'vitest';
import {
  formatPayosDescription,
  generatePayosOrderCode,
  isValidPayosOrderCode,
} from './payos-order-code.util.js';

describe('payos-order-code.util', () => {
  describe('generatePayosOrderCode', () => {
    it('generates a valid positive safe integer within PayOS limits', () => {
      const code = generatePayosOrderCode();
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(isValidPayosOrderCode(code)).toBe(true);
    });

    it('generates unique monotonic numbers across rapid calls', () => {
      const codes = new Set<number>();
      for (let i = 0; i < 50; i++) {
        codes.add(generatePayosOrderCode());
      }
      expect(codes.size).toBe(50);
    });
  });

  describe('isValidPayosOrderCode', () => {
    it('returns true for positive integers within safe range', () => {
      expect(isValidPayosOrderCode(123456)).toBe(true);
      expect(isValidPayosOrderCode(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it('returns false for negative, zero, float, or string values', () => {
      expect(isValidPayosOrderCode(0)).toBe(false);
      expect(isValidPayosOrderCode(-1)).toBe(false);
      expect(isValidPayosOrderCode(12.34)).toBe(false);
      expect(isValidPayosOrderCode('123456')).toBe(false);
      expect(isValidPayosOrderCode(null)).toBe(false);
      expect(isValidPayosOrderCode(undefined)).toBe(false);
      expect(isValidPayosOrderCode(Number.MAX_SAFE_INTEGER + 1000)).toBe(false);
    });
  });

  describe('formatPayosDescription', () => {
    it('formats description under 25 chars without truncation', () => {
      expect(formatPayosDescription('ORD-123')).toBe('Don hang ORD-123');
    });

    it('truncates long order numbers so total length does not exceed 25 chars', () => {
      const desc = formatPayosDescription(
        'NEXUS-20261102-VERY-LONG-ORDER-NUMBER',
      );
      expect(desc.length).toBeLessThanOrEqual(25);
      expect(desc).toBe('Don hang NEXUS-20261102-V');
    });
  });
});
