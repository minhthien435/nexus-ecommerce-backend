import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateOrderDisputeDto } from './create-order-dispute.dto.js';

describe('CreateOrderDisputeDto validation', () => {
  it('validates a correct dispute payload', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'DAMAGED';
    dto.evidenceDescription = 'Sản phẩm nhận được bị nứt vỡ';
    dto.evidenceImages = [
      'https://example.com/image-1.jpg',
      'https://example.com/image-2.jpg',
    ];

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('allows empty evidenceImages array', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'WRONG_ITEM';
    dto.evidenceDescription = 'Giao sai màu sắc so với đơn hàng đã đặt';
    dto.evidenceImages = [];

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('allows undefined evidenceImages', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'NOT_AS_DESCRIBED';
    dto.evidenceDescription = 'Chất lượng sản phẩm không đúng với quảng cáo';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects an invalid reasonCategory', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'INVALID_REASON' as never;
    dto.evidenceDescription = 'Lý do không hợp lệ';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('reasonCategory');
  });

  it('rejects short or empty evidenceDescription', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'COUNTERFEIT';
    dto.evidenceDescription = 'ngắn';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('evidenceDescription');
  });

  it('rejects more than 5 evidenceImages', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'MISSING_PARTS';
    dto.evidenceDescription = 'Kiện hàng bị thiếu linh kiện quan trọng';
    dto.evidenceImages = [
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
      'https://example.com/5.jpg',
      'https://example.com/6.jpg',
    ];

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('evidenceImages');
  });

  it('rejects invalid image URLs', async () => {
    const dto = new CreateOrderDisputeDto();
    dto.reasonCategory = 'OTHER';
    dto.evidenceDescription = 'Kiểm tra lỗi URL ảnh không hợp lệ';
    dto.evidenceImages = ['invalid-url-string'];

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('evidenceImages');
  });
});
