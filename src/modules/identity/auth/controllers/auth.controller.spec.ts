import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  const response = {} as never;
  const request = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  } as never;

  it('verifies captcha before checking password credentials', async () => {
    const auth = { login: vi.fn() };
    const captcha = {
      verify: vi.fn().mockRejectedValue(new BadRequestException()),
    };
    const controller = new AuthController(
      auth as never,
      {} as never,
      captcha as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.login(
        {
          email: 'user@example.com',
          password: 'Password1!',
          captchaToken: 'invalid',
        },
        request,
        response,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('verifies captcha, authenticates, returns the login result, and sets the refresh cookie', async () => {
    const auth = {
      login: vi.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'user@example.com' },
        accessToken: 'access',
        rawRefreshToken: 'refresh',
      }),
    };
    const tokens = { setRefreshTokenCookie: vi.fn() };
    const captcha = { verify: vi.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(
      auth as never,
      tokens as never,
      captcha as never,
      {} as never,
      {} as never,
    );
    const dto = {
      email: 'user@example.com',
      password: 'Password1!',
      captchaToken: 'valid-captcha',
      rememberMe: true,
    };

    await expect(controller.login(dto, request, response)).resolves.toEqual({
      accessToken: 'access',
      expiresIn: 3600,
      user: { id: 'user-1', email: 'user@example.com' },
    });
    expect(captcha.verify).toHaveBeenCalledWith('valid-captcha', '127.0.0.1');
    expect(auth.login).toHaveBeenCalledWith(dto, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
    expect(captcha.verify.mock.invocationCallOrder[0]).toBeLessThan(
      auth.login.mock.invocationCallOrder[0],
    );
    expect(tokens.setRefreshTokenCookie).toHaveBeenCalledWith(
      response,
      'refresh',
    );
  });

  it('uses the same result shape and cookie behavior for Google login', async () => {
    const auth = {
      loginWithGoogle: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
        accessToken: 'access',
        rawRefreshToken: 'refresh',
      }),
    };
    const tokens = { setRefreshTokenCookie: vi.fn() };
    const google = {
      verify: vi.fn().mockResolvedValue({
        subject: 'sub',
        email: 'user@example.com',
        fullName: 'User',
      }),
    };
    const controller = new AuthController(
      auth as never,
      tokens as never,
      {} as never,
      google as never,
      {} as never,
    );
    await expect(
      controller.googleLogin({ credential: 'credential' }, request, response),
    ).resolves.toEqual({
      accessToken: 'access',
      expiresIn: 3600,
      user: { id: 'user-1' },
    });
    expect(tokens.setRefreshTokenCookie).toHaveBeenCalledWith(
      response,
      'refresh',
    );
  });

  it('does not call AuthService or set a cookie for an invalid Google credential', async () => {
    const auth = { loginWithGoogle: vi.fn() };
    const tokens = { setRefreshTokenCookie: vi.fn() };
    const google = {
      verify: vi.fn().mockRejectedValue(new UnauthorizedException()),
    };
    const controller = new AuthController(
      auth as never,
      tokens as never,
      {} as never,
      google as never,
      {} as never,
    );

    await expect(
      controller.googleLogin({ credential: 'invalid' }, request, response),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.loginWithGoogle).not.toHaveBeenCalled();
    expect(tokens.setRefreshTokenCookie).not.toHaveBeenCalled();
  });

  it('delegates forgotPassword, verifyResetOtp, and resetPassword to PasswordResetService', async () => {
    const passwordReset = {
      forgotPassword: vi
        .fn()
        .mockResolvedValue({
          email: 'user@example.com',
          expiresIn: 900,
          devOtp: '123456',
        }),
      verifyResetOtp: vi.fn().mockResolvedValue({ resetToken: 'token-abc' }),
      resetPassword: vi.fn().mockResolvedValue(null),
    };
    const controller = new AuthController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      passwordReset as never,
    );

    await expect(
      controller.forgotPassword({ email: 'user@example.com' }),
    ).resolves.toEqual({
      email: 'user@example.com',
      expiresIn: 900,
      devOtp: '123456',
    });
    expect(passwordReset.forgotPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
    });

    await expect(
      controller.verifyResetOtp({ email: 'user@example.com', otp: '123456' }),
    ).resolves.toEqual({
      resetToken: 'token-abc',
    });
    expect(passwordReset.verifyResetOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      otp: '123456',
    });

    await expect(
      controller.resetPassword({
        resetToken: 'token-abc',
        newPassword: 'NewPassword123@',
      }),
    ).resolves.toBeNull();
    expect(passwordReset.resetPassword).toHaveBeenCalledWith({
      resetToken: 'token-abc',
      newPassword: 'NewPassword123@',
    });
  });
});
