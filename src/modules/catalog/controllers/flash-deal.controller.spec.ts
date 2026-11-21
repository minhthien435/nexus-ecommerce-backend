import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { FlashDealController } from './flash-deal.controller.js';

describe('FlashDealController routes', () => {
  it('uses the canonical public route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FlashDealController)).toBe(
      'api/v1/flash-deals',
    );
  });
});
