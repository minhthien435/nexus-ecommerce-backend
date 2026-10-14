import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecaptchaService } from './recaptcha.service.js';

describe('RecaptchaService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails closed when the secret is missing', async () => {
    const service = new RecaptchaService({ get: vi.fn() } as never);
    await expect(service.verify('token')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('accepts a successful response with the expected hostname', async () => {
    const config = {
      get: vi.fn((key) =>
        key === 'RECAPTCHA_SECRET_KEY' ? 'secret' : 'app.test',
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ success: true, hostname: 'app.test' }),
      }),
    );
    await expect(
      new RecaptchaService(config as never).verify('token'),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid or hostname-mismatched responses', async () => {
    const config = {
      get: vi.fn((key) =>
        key === 'RECAPTCHA_SECRET_KEY' ? 'secret' : 'app.test',
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ success: true, hostname: 'evil.test' }),
      }),
    );
    await expect(
      new RecaptchaService(config as never).verify('token'),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails closed on provider errors', async () => {
    const config = {
      get: vi.fn((key) =>
        key === 'RECAPTCHA_SECRET_KEY' ? 'secret' : undefined,
      ),
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(
      new RecaptchaService(config as never).verify('token'),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
