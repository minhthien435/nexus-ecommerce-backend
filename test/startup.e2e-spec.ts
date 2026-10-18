import { AppModule } from '../src/app.module.js';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { CartEntity } from '../src/modules/commerce/domain/entities/cart.entity.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';
import { AuthService } from '../src/modules/identity/auth/services/auth.service.js';
import { RecaptchaService } from '../src/modules/identity/auth/services/recaptcha.service.js';
import { CartMergeApi } from '../src/modules/commerce/cart-merge.api.js';
import { CartWriteService } from '../src/modules/commerce/services/cart-write.service.js';
import { LoginCartMergeService } from '../src/modules/auth-cart/services/login-cart-merge.service.js';
import { CatalogCartApi } from '../src/modules/catalog/catalog-cart.api.js';
import { CatalogCartService } from '../src/modules/catalog/services/catalog-cart.service.js';
import { ProductSearchService } from '../src/modules/catalog/services/product-search.service.js';
import { ProductSkuService } from '../src/modules/catalog/services/product-sku.service.js';
import { ProductController } from '../src/modules/catalog/controllers/product.controller.js';
import { ProductSkuController } from '../src/modules/catalog/controllers/product-sku.controller.js';

describe('Application startup module graph (e2e)', () => {
  it('loads the complete AppModule without circular initialization errors', () => {
    expect(AppModule).toBeDefined();
  });

  it('initializes the real module graph and resolves shared authentication for cart and Catalog', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const users = {
      findOne: vi.fn().mockResolvedValue({ id: userId, tokenVersion: 0 }),
    };
    const carts = {
      findOne: vi.fn().mockResolvedValue(null),
      query: vi
        .fn()
        .mockResolvedValue([
          { observedTime: new Date('2026-10-17T12:00:00Z') },
        ]),
    };
    const source = {
      options: { type: 'postgres' },
      entityMetadatas: [],
      getRepository: (entity: unknown) =>
        entity === UserEntity ? users : entity === CartEntity ? carts : {},
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(source)
      .overrideProvider(RbacService)
      .useValue({ hasAllPermissions: vi.fn().mockResolvedValue(true) })
      .overrideProvider(AuthService)
      .useValue({
        login: vi.fn().mockResolvedValue({
          user: { id: userId },
          accessToken: 'access',
          rawRefreshToken: 'refresh',
        }),
      })
      .overrideProvider(RecaptchaService)
      .useValue({ verify: vi.fn().mockResolvedValue(undefined) })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      expect(module.get(CartMergeApi)).toBe(module.get(CartWriteService));
      expect(module.get(LoginCartMergeService)).toBeDefined();
      expect(module.get(CatalogCartApi)).toBeInstanceOf(CatalogCartService);
      expect(module.get(ProductSearchService)).toBeDefined();
      expect(module.get(ProductSkuService)).toBeDefined();
      expect(module.get(ProductController)).toBeDefined();
      expect(module.get(ProductSkuController)).toBeDefined();
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'user@example.com',
          password: 'pass',
          captchaToken: 'captcha',
          guestCartItems: [],
        })
        .expect(200);
      expect(login.body.data.cartMerge).toEqual({
        status: 'skipped',
        accepted: [],
        skipped: [],
      });
      expect(login.headers['set-cookie'][0]).toContain('refreshToken=refresh');
      await request(app.getHttpServer())
        .get('/api/v1/commerce/cart')
        .expect(401);
      const token = await module
        .get(JwtService)
        .signAsync({ sub: userId, tokenVersion: 0 });
      const response = await request(app.getHttpServer())
        .get('/api/v1/commerce/cart')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body).toMatchObject({
        success: true,
        data: { items: [], subtotal: '0.00' },
      });
      expect(carts.findOne).toHaveBeenCalledWith({
        where: {
          userId,
          status: 'ACTIVE',
        },
      });
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
