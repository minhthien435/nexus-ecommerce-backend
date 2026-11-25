import { ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { ProductReviewController } from './product-review.controller.js';

describe('ProductReviewController', () => {
  it('delegates all four endpoints and guards writes', async () => {
    const reviews = {
      create: vi.fn().mockResolvedValue('created'),
      product: vi.fn().mockResolvedValue('product'),
      shop: vi.fn().mockResolvedValue('shop'),
      reply: vi.fn().mockResolvedValue('reply'),
    };
    const controller = new ProductReviewController(reviews as never);
    expect(Reflect.getMetadata(PATH_METADATA, ProductReviewController)).toBe(
      'api/v1/catalog',
    );
    await expect(
      controller.create('buyer', { orderItemId: 'item', rating: 5 }),
    ).resolves.toBe('created');
    await expect(
      controller.product('slug', { page: 1, limit: 20 }),
    ).resolves.toBe('product');
    await expect(controller.shop('shop', { page: 1, limit: 20 })).resolves.toBe(
      'shop',
    );
    await expect(
      controller.reply('seller', 'review', { reply: 'Thanks' }),
    ).resolves.toBe('reply');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ProductReviewController.prototype.create,
      ),
    ).toHaveLength(2);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ProductReviewController.prototype.create,
      ),
    ).toBe('reviews');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ProductReviewController.prototype.create,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        ProductReviewController.prototype.reply,
      ),
    ).toBe('seller/reviews/:id/reply');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        ProductReviewController.prototype.reply,
      ),
    ).toBe(RequestMethod.POST);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ProductReviewController.prototype.reply,
      ),
    ).toHaveLength(2);
    const replyArguments = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      ProductReviewController,
      'reply',
    ) as Record<string, { data?: unknown; pipes?: unknown[] }>;
    const reviewIdArgument = Object.values(replyArguments).find(
      (argument) => argument.data === 'id',
    );
    expect(reviewIdArgument?.pipes).toContain(ParseUUIDPipe);
  });
});
