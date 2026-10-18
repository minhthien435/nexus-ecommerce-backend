import { centsToMoney, moneyToCents } from './cart-money.js';

describe('Cart decimal money', () => {
  it('adds decimal cents without floating point or unsafe integer conversions', () => {
    expect(centsToMoney(moneyToCents('0.10') + moneyToCents('0.20'))).toBe(
      '0.30',
    );
    expect(
      centsToMoney(moneyToCents('9999999999999999.99') * 2147483647n),
    ).toBe('21474836469999999978525163.53');
    expect(centsToMoney(moneyToCents('1'))).toBe('1.00');
    expect(centsToMoney(moneyToCents('1.2'))).toBe('1.20');
  });
  it.each(['0.001', '-1', 'NaN', '1e2', '10000000000000000.00'])(
    'rejects invalid numeric(18,2): %s',
    (value) => {
      expect(() => moneyToCents(value)).toThrow();
    },
  );
});
