import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './register.dto.js';
import { LoginDto } from './login.dto.js';
import { GoogleLoginDto } from './google-login.dto.js';

describe.each([
  {
    name: 'password',
    dto: LoginDto,
    base: {
      email: 'user@example.com',
      password: 'pass',
      captchaToken: 'captcha',
    },
  },
  { name: 'Google', dto: GoogleLoginDto, base: { credential: 'credential' } },
])('$name guest cart validation', ({ dto, base }) => {
  const skuId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
  const check = (value: unknown) =>
    validate(plainToInstance(dto as typeof LoginDto, value), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  it.each(
    [
      undefined,
      [],
      [{ skuId, quantity: 1 }],
      [{ skuId, quantity: 2147483647 }],
      Array.from({ length: 100 }, () => ({ skuId, quantity: 1 })),
    ].map((value) => [value]),
  )('accepts optional valid input %j', async (guestCartItems) => {
    expect(
      await check({
        ...base,
        ...(guestCartItems === undefined ? {} : { guestCartItems }),
      }),
    ).toHaveLength(0);
  });
  it.each(
    [
      null,
      {},
      'bad',
      1,
      [null],
      [[]],
      [{}],
      [{ skuId: 'bad', quantity: 1 }],
      ...[0, -1, 1.1, 2147483648, '1', null, true].map((quantity) => [
        { skuId, quantity },
      ]),
      ...['userId', 'productId', 'sellerId', 'price', 'unitPriceSnapshot'].map(
        (key) => [{ skuId, quantity: 1, [key]: 'forged' }],
      ),
      Array.from({ length: 101 }, () => ({ skuId, quantity: 1 })),
    ].map((value) => [value]),
  )('rejects invalid nested input %j', async (guestCartItems) => {
    expect((await check({ ...base, guestCartItems })).length).toBeGreaterThan(
      0,
    );
  });
});

describe('Auth DTOs Validation', () => {
  describe('RegisterDto', () => {
    it('chấp nhận dữ liệu đăng ký hợp lệ', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'Password123!',
        fullName: 'Nguyễn Văn A',
        phone: '0912345678',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('cho phép không truyền phone (optional)', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'Password123!',
        fullName: 'Nguyễn Văn A',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('từ chối email sai định dạng', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'invalid-email',
        password: 'Password123!',
        fullName: 'Nguyễn Văn A',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('từ chối mật khẩu dưới 8 ký tự', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'Pass1!',
        fullName: 'Nguyễn Văn A',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('từ chối mật khẩu không có chữ hoa hoặc số', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'passwordonly',
        fullName: 'Nguyễn Văn A',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('từ chối mật khẩu không có ký tự đặc biệt (BR-01)', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'Abcdefg1',
        fullName: 'Nguyễn Văn A',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('từ chối số điện thoại sai định dạng (không phải 10 số)', async () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        password: 'Password123!',
        fullName: 'Nguyễn Văn A',
        phone: '091234',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'phone')).toBe(true);
    });
  });

  describe('LoginDto', () => {
    it('chấp nhận thông tin đăng nhập hợp lệ', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password: 'Password123!',
        captchaToken: 'captcha-token',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('từ chối email trống hoặc sai định dạng', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'notanemail',
        password: 'Password123!',
        captchaToken: 'captcha-token',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('từ chối mật khẩu để trống', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password: '',
        captchaToken: 'captcha-token',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('chấp nhận đăng nhập khi không có captchaToken (optional) và chấp nhận rememberMe', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password: 'Password123!',

        rememberMe: true,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
