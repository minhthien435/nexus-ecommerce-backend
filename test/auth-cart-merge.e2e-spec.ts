import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../src/modules/identity/auth/controllers/auth.controller.js';
import { AuthService } from '../src/modules/identity/auth/services/auth.service.js';
import { TokenService } from '../src/modules/identity/auth/services/token.service.js';
import { RecaptchaService } from '../src/modules/identity/auth/services/recaptcha.service.js';
import { GoogleIdTokenService } from '../src/modules/identity/auth/services/google-id-token.service.js';
import { PasswordResetService } from '../src/modules/identity/auth/services/password-reset.service.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';
import { CartMergeApi } from '../src/modules/commerce/cart-merge.api.js';
import { LoginCartMergeService } from '../src/modules/auth-cart/services/login-cart-merge.service.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const skuId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
describe('Login guest cart integration (HTTP, mocked Auth and Cart boundaries)', () => {
  let app: INestApplication;
  const auth = { login: vi.fn(), loginWithGoogle: vi.fn(), register: vi.fn() };
  const captcha = { verify: vi.fn() };
  const google = { verify: vi.fn() };
  const rbac = { hasAllPermissions: vi.fn() };
  const cart = { mergeItems: vi.fn() };
  const tokens = {
    setRefreshTokenCookie: vi.fn(),
    rotateRefreshToken: vi.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        LoginCartMergeService,
        { provide: AuthService, useValue: auth },
        { provide: TokenService, useValue: tokens },
        { provide: RecaptchaService, useValue: captcha },
        { provide: GoogleIdTokenService, useValue: google },
        { provide: PasswordResetService, useValue: {} },
        { provide: RbacService, useValue: rbac },
        { provide: CartMergeApi, useValue: cart },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    const result = {
      user: { id: userId, email: 'user@example.com' },
      accessToken: 'access',
      rawRefreshToken: 'refresh',
    };
    auth.login.mockResolvedValue(result);
    auth.loginWithGoogle.mockResolvedValue(result);
    google.verify.mockResolvedValue({
      subject: 'subject',
      email: 'user@example.com',
    });
    rbac.hasAllPermissions.mockResolvedValue(true);
    cart.mergeItems.mockResolvedValue({
      status: 'merged',
      accepted: [{ skuId: skuId.toLowerCase(), quantityAdded: 3, quantity: 5 }],
      skipped: [],
      cart: { subtotal: '500.00' },
    });
    tokens.setRefreshTokenCookie.mockImplementation((res, value) =>
      res.cookie('refreshToken', value, { httpOnly: true }),
    );
  });
  afterAll(async () => app.close());
  describe.each([
    {
      name: 'password',
      path: 'login',
      base: {
        email: 'user@example.com',
        password: 'pass',
        captchaToken: 'captcha',
      },
    },
    { name: 'Google', path: 'google', base: { credential: 'credential' } },
  ])('$name login', ({ path, base }) => {
    const login = (body: object) =>
      request(app.getHttpServer())
        .post(`/api/v1/auth/${path}?userId=forged`)
        .send({ ...base, ...body });
    it('preserves absent input response/cookie and does not call RBAC or cart', async () => {
      const response = await login({}).expect(200);
      expect(response.body.data).toEqual({
        user: { id: userId, email: 'user@example.com' },
        accessToken: 'access',
        expiresIn: 3600,
      });
      expect(response.headers['set-cookie'][0]).toContain(
        'refreshToken=refresh',
      );
      expect(rbac.hasAllPermissions).not.toHaveBeenCalled();
      expect(cart.mergeItems).not.toHaveBeenCalled();
    });
    it.each(
      [
        null,
        {},
        'bad',
        [null],
        [[]],
        [{}],
        [{ skuId: 'bad', quantity: 1 }],
        ...[0, -1, 1.5, 2147483648, '1', null, true].map((quantity) => [
          { skuId, quantity },
        ]),
        ...[
          'userId',
          'sellerId',
          'productId',
          'price',
          'unitPriceSnapshot',
        ].map((key) => [{ skuId, quantity: 1, [key]: 'forged' }]),
        Array.from({ length: 101 }, () => ({ skuId, quantity: 1 })),
      ].map((value) => [value]),
    )(
      'rejects malformed input before any authentication %j',
      async (guestCartItems) => {
        await login({ guestCartItems }).expect(400);
        expect(captcha.verify).not.toHaveBeenCalled();
        expect(google.verify).not.toHaveBeenCalled();
        expect(auth.login).not.toHaveBeenCalled();
        expect(auth.loginWithGoogle).not.toHaveBeenCalled();
        expect(rbac.hasAllPermissions).not.toHaveBeenCalled();
        expect(cart.mergeItems).not.toHaveBeenCalled();
      },
    );
    it('rejects top-level forged ownership before authentication', async () => {
      await login({ userId: 'forged', guestCartItems: [] }).expect(400);
      expect(auth.login).not.toHaveBeenCalled();
      expect(auth.loginWithGoogle).not.toHaveBeenCalled();
    });
    it.each(['constructor', '__proto__'])(
      'rejects raw nested JSON property %s before authentication',
      async (key) => {
        const row = JSON.parse(
          `{"skuId":"${skuId}","quantity":1,"${key}":{"forged":true}}`,
        );
        expect(Object.hasOwn(row, key)).toBe(true);
        await login({ guestCartItems: [row] }).expect(400);
        expect(captcha.verify).not.toHaveBeenCalled();
        expect(google.verify).not.toHaveBeenCalled();
        expect(auth.login).not.toHaveBeenCalled();
        expect(auth.loginWithGoogle).not.toHaveBeenCalled();
        expect(rbac.hasAllPermissions).not.toHaveBeenCalled();
        expect(cart.mergeItems).not.toHaveBeenCalled();
        expect(tokens.setRefreshTokenCookie).not.toHaveBeenCalled();
      },
    );
    it('returns an empty skipped outcome without RBAC or cart writes', async () => {
      const response = await login({ guestCartItems: [] }).expect(200);
      expect(response.body.data.cartMerge).toEqual({
        status: 'skipped',
        accepted: [],
        skipped: [],
      });
      expect(rbac.hasAllPermissions).not.toHaveBeenCalled();
      expect(cart.mergeItems).not.toHaveBeenCalled();
    });
    it('passes authenticated ownership after login and preserves a merge projection', async () => {
      const input = [{ skuId, quantity: 3 }];
      const response = await login({ guestCartItems: input }).expect(200);
      expect(response.body.data.cartMerge).toMatchObject({
        status: 'merged',
        cart: { subtotal: '500.00' },
      });
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(userId, [
        'CART.CREATE',
      ]);
      expect(cart.mergeItems).toHaveBeenCalledWith(userId, input);
      const authenticated =
        path === 'login' ? auth.login : auth.loginWithGoogle;
      expect(authenticated.mock.invocationCallOrder[0]).toBeLessThan(
        rbac.hasAllPermissions.mock.invocationCallOrder[0],
      );
    });
    it('does not merge after failed authentication', async () => {
      (path === 'login' ? auth.login : auth.loginWithGoogle).mockRejectedValue(
        new UnauthorizedException(),
      );
      await login({ guestCartItems: [{ skuId, quantity: 3 }] }).expect(401);
      expect(cart.mergeItems).not.toHaveBeenCalled();
      expect(tokens.setRefreshTokenCookie).not.toHaveBeenCalled();
    });
    it.each(['denied', 'permission error', 'merge error'])(
      'preserves auth/token/cookie after %s',
      async (kind) => {
        if (kind === 'denied') rbac.hasAllPermissions.mockResolvedValue(false);
        else
          (kind === 'permission error'
            ? rbac.hasAllPermissions
            : cart.mergeItems
          ).mockRejectedValue(new Error('secret SQL failure'));
        const response = await login({
          guestCartItems: [{ skuId, quantity: 3 }],
        }).expect(200);
        expect(response.body.data).toMatchObject({
          user: { id: userId },
          accessToken: 'access',
          expiresIn: 3600,
          cartMerge: {
            status: kind === 'denied' ? 'forbidden' : 'failed',
            accepted: [],
            skipped: [],
          },
        });
        expect(JSON.stringify(response.body)).not.toContain('secret');
        expect(response.headers['set-cookie'][0]).toContain(
          'refreshToken=refresh',
        );
        if (kind !== 'merge error')
          expect(cart.mergeItems).not.toHaveBeenCalled();
      },
    );
  });
  it('keeps register and refresh outside merge coordination', async () => {
    auth.register.mockResolvedValue({ id: userId });
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.com',
        password: 'Password1!',
        fullName: 'User',
      })
      .expect(201);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    expect(rbac.hasAllPermissions).not.toHaveBeenCalled();
    expect(cart.mergeItems).not.toHaveBeenCalled();
  });
});
