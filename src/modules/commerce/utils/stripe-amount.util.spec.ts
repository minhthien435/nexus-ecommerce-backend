import { describe, expect, it } from 'vitest';
import {
  fromStripeAmount,
  isSupportedStripeCurrency,
  isZeroDecimalCurrency,
  toStripeAmount,
} from './stripe-amount.util.js';

describe('stripe-amount.util', () => {
  describe('isZeroDecimalCurrency', () => {
    it('identifies VND as zero-decimal', () => {
      expect(isZeroDecimalCurrency('VND')).toBe(true);
      expect(isZeroDecimalCurrency('vnd')).toBe(true);
      expect(isZeroDecimalCurrency(' VND ')).toBe(true);
    });

    it('identifies USD and EUR as non zero-decimal', () => {
      expect(isZeroDecimalCurrency('USD')).toBe(false);
      expect(isZeroDecimalCurrency('EUR')).toBe(false);
      expect(isZeroDecimalCurrency('JPY')).toBe(false);
    });
  });

  describe('isSupportedStripeCurrency', () => {
    it('accepts explicitly supported currencies', () => {
      expect(isSupportedStripeCurrency('VND')).toBe(true);
      expect(isSupportedStripeCurrency('USD')).toBe(true);
      expect(isSupportedStripeCurrency('EUR')).toBe(true);
    });

    it('rejects unsupported currencies', () => {
      expect(isSupportedStripeCurrency('GBP')).toBe(false);
      expect(isSupportedStripeCurrency('BTC')).toBe(false);
      expect(isSupportedStripeCurrency('')).toBe(false);
    });
  });

  describe('toStripeAmount - VND (Zero-decimal)', () => {
    it('converts exact decimal representation to integer without multiplying by 100', () => {
      expect(toStripeAmount('550000.00', 'VND')).toBe(550000);
      expect(toStripeAmount('550000.0', 'VND')).toBe(550000);
      expect(toStripeAmount('550000', 'VND')).toBe(550000);
      expect(toStripeAmount(550000, 'VND')).toBe(550000);
    });

    it('converts large safe integer amounts correctly', () => {
      expect(toStripeAmount('999999999.00', 'VND')).toBe(999999999);
    });

    it('rejects non-zero fractional dong', () => {
      expect(() => toStripeAmount('550000.50', 'VND')).toThrow(
        /does not support fractional units/,
      );
      expect(() => toStripeAmount('550000.01', 'VND')).toThrow(
        /does not support fractional units/,
      );
    });
  });

  describe('toStripeAmount - USD and EUR (Two-decimal)', () => {
    it('converts decimal amounts to minor units (cents) without floating-point errors', () => {
      expect(toStripeAmount('15.50', 'USD')).toBe(1550);
      expect(toStripeAmount('15.5', 'USD')).toBe(1550);
      expect(toStripeAmount('15', 'USD')).toBe(1500);
      expect(toStripeAmount('0.99', 'USD')).toBe(99);
      expect(toStripeAmount('0.05', 'USD')).toBe(5);
      expect(toStripeAmount(15.5, 'USD')).toBe(1550);
      expect(toStripeAmount('49.99', 'EUR')).toBe(4999);
    });

    it('rejects amounts with more than 2 decimal places', () => {
      expect(() => toStripeAmount('15.555', 'USD')).toThrow(
        /supports at most 2 decimal places/,
      );
    });
  });

  describe('toStripeAmount - Edge cases and validation', () => {
    it('rejects zero or negative amounts', () => {
      expect(() => toStripeAmount('0', 'VND')).toThrow(
        /Amount must be greater than zero/,
      );
      expect(() => toStripeAmount('0.00', 'VND')).toThrow(
        /Amount must be greater than zero/,
      );
      expect(() => toStripeAmount('-100', 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount('-0.01', 'USD')).toThrow(
        /Invalid monetary amount/,
      );
    });

    it('rejects malformed and non-finite values', () => {
      expect(() => toStripeAmount('abc', 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount('', 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount('  ', 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount('12.34.56', 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount(NaN, 'VND')).toThrow(
        /Invalid monetary amount/,
      );
      expect(() => toStripeAmount(Infinity, 'VND')).toThrow(
        /Invalid monetary amount/,
      );
    });

    it('rejects null or undefined inputs', () => {
      expect(() => toStripeAmount(null as unknown as string, 'VND')).toThrow(
        /Amount is required/,
      );
      expect(() =>
        toStripeAmount(undefined as unknown as string, 'VND'),
      ).toThrow(/Amount is required/);
    });

    it('rejects unsupported currencies', () => {
      expect(() => toStripeAmount('100.00', 'JPY')).toThrow(
        /Unsupported Stripe currency/,
      );
      expect(() => toStripeAmount('100.00', 'INVALID')).toThrow(
        /Unsupported Stripe currency/,
      );
      expect(() => toStripeAmount('100.00', '')).toThrow(
        /Unsupported Stripe currency/,
      );
    });
  });

  describe('fromStripeAmount', () => {
    it('converts VND integer units back to decimal string format', () => {
      expect(fromStripeAmount(550000, 'VND')).toBe('550000.00');
    });

    it('converts USD minor units (cents) back to decimal string format', () => {
      expect(fromStripeAmount(1550, 'USD')).toBe('15.50');
      expect(fromStripeAmount(1500, 'USD')).toBe('15.00');
      expect(fromStripeAmount(99, 'USD')).toBe('0.99');
      expect(fromStripeAmount(5, 'USD')).toBe('0.05');
    });

    it('rejects non-integer or non-positive amounts', () => {
      expect(() => fromStripeAmount(0, 'VND')).toThrow(
        /Invalid Stripe integer amount/,
      );
      expect(() => fromStripeAmount(-100, 'VND')).toThrow(
        /Invalid Stripe integer amount/,
      );
      expect(() => fromStripeAmount(15.5, 'USD')).toThrow(
        /Invalid Stripe integer amount/,
      );
    });

    it('rejects unsupported currencies', () => {
      expect(() => fromStripeAmount(100, 'JPY')).toThrow(
        /Unsupported Stripe currency/,
      );
    });
  });
});
