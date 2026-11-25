import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateProductReviewDto,
  ProductReviewQueryDto,
  ReplyProductReviewDto,
} from './product-review.dto.js';

describe('product review DTOs', () => {
  it('accepts a valid review and rejects malformed review fields', async () => {
    const valid = plainToInstance(CreateProductReviewDto, {
      orderItemId: '11111111-1111-4111-8111-111111111111',
      rating: 5,
      comment: '  Great  ',
      imageUrls: ['https://example.com/a.jpg'],
    });
    expect(valid.comment).toBe('Great');
    expect(await validate(valid)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreateProductReviewDto, {
          orderItemId: 'bad',
          rating: 0,
          comment: 'x'.repeat(1001),
          imageUrls: Array(6).fill('bad'),
        }),
      ),
    ).not.toHaveLength(0);
  });

  it.each([
    'ftp://example.com/a.jpg',
    'javascript:alert(1)',
    'example.com/a.jpg',
    `https://example.com/${'x'.repeat(2049)}`,
  ])('rejects invalid review image URL %s', async (imageUrl) => {
    const dto = plainToInstance(CreateProductReviewDto, {
      orderItemId: '11111111-1111-4111-8111-111111111111',
      rating: 5,
      imageUrls: [imageUrl],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects invalid paging and rating filters', async () => {
    expect(
      await validate(
        plainToInstance(ProductReviewQueryDto, {
          rating: 6,
          page: 0,
          limit: 101,
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('trims seller replies and rejects whitespace-only content', async () => {
    const valid = plainToInstance(ReplyProductReviewDto, {
      reply: '  Thank you  ',
    });
    expect(valid.reply).toBe('Thank you');
    expect(await validate(valid)).toHaveLength(0);

    const whitespaceOnly = plainToInstance(ReplyProductReviewDto, {
      reply: '   ',
    });
    expect(await validate(whitespaceOnly)).not.toHaveLength(0);
  });
});
