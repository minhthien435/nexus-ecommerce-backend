import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PublicShopController } from './public-shop.controller.js';

describe('PublicShopController routes', () => {
  it('declares trusted before the dynamic shop route', () => {
    const methods = Object.getOwnPropertyNames(PublicShopController.prototype);
    expect(methods.indexOf('trusted')).toBeLessThan(methods.indexOf('profile'));
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        PublicShopController.prototype.trusted,
      ),
    ).toBe('trusted');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        PublicShopController.prototype.profile,
      ),
    ).toBe(':shop');
  });
});
