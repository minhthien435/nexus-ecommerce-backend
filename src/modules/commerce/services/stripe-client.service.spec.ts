import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeClientService } from './stripe-client.service.js';

describe('StripeClientService', () => {
  let configService: ConfigService;
  let service: StripeClientService;

  beforeEach(() => {
    configService = {
      get: vi.fn(),
    } as unknown as ConfigService;
    service = new StripeClientService(configService);
  });

  it('throws ServiceUnavailableException when STRIPE_SECRET_KEY is missing', () => {
    vi.mocked(configService.get).mockReturnValue(undefined);

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'Stripe payment gateway is not configured',
    );
  });

  it('throws ServiceUnavailableException when STRIPE_SECRET_KEY is placeholder', () => {
    vi.mocked(configService.get).mockReturnValue('sk_test_placeholder');

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
  });

  it('initializes and caches Stripe client when valid key is provided', () => {
    vi.mocked(configService.get).mockReturnValue('sk_test_valid_dummy_key');

    const client1 = service.getClient();
    const client2 = service.getClient();

    expect(client1).toBeDefined();
    expect(client1).toBe(client2);
  });
});
