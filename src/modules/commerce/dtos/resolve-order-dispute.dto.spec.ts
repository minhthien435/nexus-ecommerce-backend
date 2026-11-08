import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ResolveOrderDisputeDto } from './resolve-order-dispute.dto.js';

describe('ResolveOrderDisputeDto', () => {
  it('hợp lệ với quyết định ACCEPTED_REFUND và ghi chú đầy đủ', async () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'ACCEPTED_REFUND',
      staffDecisionNote: 'Đồng ý hoàn tiền do sản phẩm bị hư hỏng xác thực.',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('hợp lệ với quyết định REJECTED_PAY_SELLER và ghi chú đầy đủ', async () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'REJECTED_PAY_SELLER',
      staffDecisionNote:
        'Bác bỏ khiếu nại do người mua không cung cấp đủ bằng chứng xác thực.',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('tự động trim khoảng trắng thừa ở staffDecisionNote', () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'ACCEPTED_REFUND',
      staffDecisionNote: '   Đồng ý hoàn tiền hợp lệ   ',
    });
    expect(dto.staffDecisionNote).toBe('Đồng ý hoàn tiền hợp lệ');
  });

  it('báo lỗi khi decision không thuộc ACCEPTED_REFUND hoặc REJECTED_PAY_SELLER', async () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'INVALID_DECISION',
      staffDecisionNote: 'Ghi chú hợp lệ',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('decision');
  });

  it('báo lỗi khi staffDecisionNote để trống hoặc quá ngắn (< 5 ký tự)', async () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'ACCEPTED_REFUND',
      staffDecisionNote: '  ok ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'staffDecisionNote')).toBe(true);
  });

  it('báo lỗi khi staffDecisionNote vượt quá 2000 ký tự', async () => {
    const dto = plainToInstance(ResolveOrderDisputeDto, {
      decision: 'ACCEPTED_REFUND',
      staffDecisionNote: 'A'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'staffDecisionNote')).toBe(true);
  });
});
