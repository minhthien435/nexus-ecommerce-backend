import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UpdateBuyerRefundAccountDto } from './update-buyer-refund-account.dto.js';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const transform = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpdateBuyerRefundAccountDto });

describe('UpdateBuyerRefundAccountDto', () => {
  it('trims whitespace and upper-cases accountHolderName for valid input', async () => {
    const result = (await transform({
      bankName: '  Vietcombank  ',
      accountNumber: '  1234567890  ',
      accountHolderName: '  nguyen van a  ',
    })) as UpdateBuyerRefundAccountDto;

    expect(result.bankName).toBe('Vietcombank');
    expect(result.accountNumber).toBe('1234567890');
    expect(result.accountHolderName).toBe('NGUYEN VAN A');
  });

  it('rejects missing or empty fields', async () => {
    await expect(transform({})).rejects.toMatchObject({ status: 400 });
    await expect(
      transform({
        bankName: '',
        accountNumber: '12345678',
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '   ',
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '12345678',
        accountHolderName: '',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects bankName outside 2..100 characters', async () => {
    await expect(
      transform({
        bankName: 'V',
        accountNumber: '12345678',
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      transform({
        bankName: 'V'.repeat(101),
        accountNumber: '12345678',
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects accountNumber outside 6..50 characters', async () => {
    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '12345',
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '1'.repeat(51),
        accountHolderName: 'NGUYEN VAN A',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects accountHolderName outside 2..150 characters', async () => {
    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '12345678',
        accountHolderName: 'A',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      transform({
        bankName: 'Vietcombank',
        accountNumber: '12345678',
        accountHolderName: 'A'.repeat(151),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
