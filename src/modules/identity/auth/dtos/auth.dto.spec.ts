import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './register.dto.js';
import { LoginDto } from './login.dto.js';

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
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('từ chối email trống hoặc sai định dạng', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'notanemail',
        password: 'Password123!',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('từ chối mật khẩu để trống', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password: '',
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });
  });
});
