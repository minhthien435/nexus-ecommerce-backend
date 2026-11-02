import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as payosNode from '@payos/node';
import { PayosClientService } from './payos-client.service.js';

describe('PayosClientService', () => {
  let configService: ConfigService;
  let service: PayosClientService;

  beforeEach(() => {
    vi.restoreAllMocks();
    configService = {
      get: vi.fn(),
    } as unknown as ConfigService;
    service = new PayosClientService(configService);
  });

  it('initializes and caches PayOS client when valid credentials are provided', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return 'mock-client-id';
        case 'PAYOS_API_KEY':
          return 'mock-api-key';
        case 'PAYOS_CHECKSUM_KEY':
          return 'mock-checksum-key';
        default:
          return undefined;
      }
    });

    const client1 = service.getClient();
    const client2 = service.getClient();

    expect(client1).toBeDefined();
    expect(client1).toBe(client2);
    expect(client1.clientId).toBe('mock-client-id');
    expect(client1.apiKey).toBe('mock-api-key');
    expect(client1.checksumKey).toBe('mock-checksum-key');
  });

  it('throws ServiceUnavailableException when PAYOS_CLIENT_ID is missing', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return undefined;
        case 'PAYOS_API_KEY':
          return 'mock-api-key';
        case 'PAYOS_CHECKSUM_KEY':
          return 'mock-checksum-key';
        default:
          return undefined;
      }
    });

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'PayOS payment gateway is not configured: missing PAYOS_CLIENT_ID',
    );
  });

  it('throws ServiceUnavailableException when PAYOS_CLIENT_ID is empty or whitespace', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return '   ';
        case 'PAYOS_API_KEY':
          return 'mock-api-key';
        case 'PAYOS_CHECKSUM_KEY':
          return 'mock-checksum-key';
        default:
          return undefined;
      }
    });

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'PayOS payment gateway is not configured: missing PAYOS_CLIENT_ID',
    );
  });

  it('throws ServiceUnavailableException when PAYOS_API_KEY is missing', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return 'mock-client-id';
        case 'PAYOS_API_KEY':
          return undefined;
        case 'PAYOS_CHECKSUM_KEY':
          return 'mock-checksum-key';
        default:
          return undefined;
      }
    });

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'PayOS payment gateway is not configured: missing PAYOS_API_KEY',
    );
  });

  it('throws ServiceUnavailableException when PAYOS_CHECKSUM_KEY is missing', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return 'mock-client-id';
        case 'PAYOS_API_KEY':
          return 'mock-api-key';
        case 'PAYOS_CHECKSUM_KEY':
          return undefined;
        default:
          return undefined;
      }
    });

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'PayOS payment gateway is not configured: missing PAYOS_CHECKSUM_KEY',
    );
  });

  it('handles client initialization error by throwing ServiceUnavailableException', () => {
    vi.mocked(configService.get).mockImplementation((key: string) => {
      switch (key) {
        case 'PAYOS_CLIENT_ID':
          return 'mock-client-id';
        case 'PAYOS_API_KEY':
          return 'mock-api-key';
        case 'PAYOS_CHECKSUM_KEY':
          return 'mock-checksum-key';
        default:
          return undefined;
      }
    });

    vi.spyOn(payosNode, 'PayOS').mockImplementation(function () {
      throw new Error('Connection refused to initialization provider');
    } as unknown as typeof payosNode.PayOS);

    expect(() => service.getClient()).toThrow(ServiceUnavailableException);
    expect(() => service.getClient()).toThrow(
      'Failed to initialize PayOS client: Connection refused to initialization provider',
    );
  });
});
