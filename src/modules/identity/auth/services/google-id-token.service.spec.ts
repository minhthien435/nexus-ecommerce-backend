import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

import { GoogleIdTokenService } from './google-id-token.service.js';

describe('GoogleIdTokenService', () => {
  beforeEach(() => verifyIdToken.mockReset());

  it('fails closed when client ID is missing', async () => {
    const service = new GoogleIdTokenService({ get: vi.fn() } as never);
    await expect(service.verify('credential')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('returns only validated identity claims', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-sub',
        email: 'USER@EXAMPLE.COM',
        email_verified: true,
        name: 'Example User',
      }),
    });
    const service = new GoogleIdTokenService({
      get: vi.fn().mockReturnValue('client-id'),
    } as never);
    await expect(service.verify('credential')).resolves.toEqual({
      subject: 'google-sub',
      email: 'user@example.com',
      fullName: 'Example User',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'credential',
      audience: 'client-id',
    });
  });

  it('bounds a verified Google name to the user entity limit', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-sub',
        email: 'user@example.com',
        email_verified: true,
        name: 'A'.repeat(151),
      }),
    });
    const service = new GoogleIdTokenService({
      get: vi.fn().mockReturnValue('client-id'),
    } as never);

    const identity = await service.verify('credential');

    expect(identity.fullName).toBe('A'.repeat(150));
  });

  it('uses a bounded email fallback when the Google name is blank', async () => {
    const longEmail = `${'a'.repeat(145)}@test.com`;
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-sub',
        email: longEmail,
        email_verified: true,
        name: '   ',
      }),
    });
    const service = new GoogleIdTokenService({
      get: vi.fn().mockReturnValue('client-id'),
    } as never);

    const identity = await service.verify('credential');

    expect(identity.fullName).toBe(longEmail.slice(0, 150));
    expect(identity.fullName).toHaveLength(150);
  });

  it('rejects unverified email or provider verification errors', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'sub', email: 'user@example.com' }),
    });
    const service = new GoogleIdTokenService({
      get: vi.fn().mockReturnValue('client-id'),
    } as never);
    await expect(service.verify('credential')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
