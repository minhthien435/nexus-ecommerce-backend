import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';

describe.each(['password', 'Google'])(
  'AuthController $0 cart merge',
  (kind) => {
    const request = { ip: '127.0.0.1', headers: {} } as never;
    const response = {} as never;
    const input = [
      { skuId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 3 },
    ];
    function setup() {
      const auth = { login: vi.fn(), loginWithGoogle: vi.fn() };
      const result = {
        user: { id: 'authenticated-user' },
        accessToken: 'access',
        rawRefreshToken: 'refresh',
      };
      auth.login.mockResolvedValue(result);
      auth.loginWithGoogle.mockResolvedValue(result);
      const tokens = { setRefreshTokenCookie: vi.fn() };
      const merge = {
        merge: vi
          .fn()
          .mockResolvedValue({ status: 'failed', accepted: [], skipped: [] }),
      };
      const controller = new AuthController(
        auth as never,
        tokens as never,
        { verify: vi.fn() } as never,
        { verify: vi.fn() } as never,
        {} as never,
        merge as never,
      );
      const login = (guestCartItems?: typeof input) =>
        kind === 'password'
          ? controller.login(
              {
                email: 'user@example.com',
                password: 'pass',
                captchaToken: 'captcha',
                ...(guestCartItems === undefined ? {} : { guestCartItems }),
              },
              request,
              response,
            )
          : controller.googleLogin(
              {
                credential: 'credential',
                ...(guestCartItems === undefined ? {} : { guestCartItems }),
              },
              request,
              response,
            );
      return { auth, tokens, merge, login };
    }
    it('preserves the absent-field response without a coordinator call', async () => {
      const s = setup();
      expect(await s.login()).toEqual({
        user: { id: 'authenticated-user' },
        accessToken: 'access',
        expiresIn: 28_800,
      });
      expect(s.merge.merge).not.toHaveBeenCalled();
    });
    it('awaits authentication and sets its cookie before the optional merge, preserving sanitized failure', async () => {
      const s = setup();
      let finish!: (value: unknown) => void;
      const auth = kind === 'password' ? s.auth.login : s.auth.loginWithGoogle;
      auth.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = s.login(input);
      await Promise.resolve();
      expect(s.merge.merge).not.toHaveBeenCalled();
      finish({
        user: { id: 'authenticated-user' },
        accessToken: 'access',
        rawRefreshToken: 'refresh',
      });
      expect(await pending).toEqual({
        user: { id: 'authenticated-user' },
        accessToken: 'access',
        expiresIn: 28_800,
        cartMerge: { status: 'failed', accepted: [], skipped: [] },
      });
      expect(s.merge.merge).toHaveBeenCalledWith('authenticated-user', input);
      expect(
        s.tokens.setRefreshTokenCookie.mock.invocationCallOrder[0],
      ).toBeLessThan(s.merge.merge.mock.invocationCallOrder[0]);
    });
    it('does not merge or set cookies after authentication fails', async () => {
      const s = setup();
      (kind === 'password'
        ? s.auth.login
        : s.auth.loginWithGoogle
      ).mockRejectedValue(new UnauthorizedException());
      await expect(s.login(input)).rejects.toThrow(UnauthorizedException);
      expect(s.merge.merge).not.toHaveBeenCalled();
      expect(s.tokens.setRefreshTokenCookie).not.toHaveBeenCalled();
    });
  },
);

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
      expiresIn: 28_800,
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
      {} as never,
    );
    await expect(
      controller.googleLogin({ credential: 'credential' }, request, response),
    ).resolves.toEqual({
      accessToken: 'access',
      expiresIn: 28_800,
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
      forgotPassword: vi.fn().mockResolvedValue({
        message: 'Mã xác minh đã được gửi đến email.',
        expiresIn: 900,
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
      {} as never,
    );

    await expect(
      controller.forgotPassword({ email: 'user@example.com' }),
    ).resolves.toEqual({
      message: 'Mã xác minh đã được gửi đến email.',
      expiresIn: 900,
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
