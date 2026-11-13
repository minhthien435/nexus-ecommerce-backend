import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JWT_ACCESS_EXPIRES_IN,
  DEFAULT_JWT_ACCESS_EXPIRES_IN_SECONDS,
  resolveJwtAccessExpiry,
} from './jwt-expiry.util.js';

describe('resolveJwtAccessExpiry', () => {
  it('parses duration strings and numeric seconds from JWT_ACCESS_EXPIRES_IN', () => {
    expect(
      resolveJwtAccessExpiry(
        new ConfigService({ JWT_ACCESS_EXPIRES_IN: '15m' }),
      ),
    ).toEqual({ signOption: '15m', seconds: 900 });

    expect(
      resolveJwtAccessExpiry(
        new ConfigService({ JWT_ACCESS_EXPIRES_IN: '2h' }),
      ),
    ).toEqual({ signOption: '2h', seconds: 7200 });

    expect(
      resolveJwtAccessExpiry(
        new ConfigService({ JWT_ACCESS_EXPIRES_IN: '3600' }),
      ),
    ).toEqual({ signOption: 3600, seconds: 3600 });
  });

  it('falls back to 8h (28800s) when unset or invalid', () => {
    expect(resolveJwtAccessExpiry(undefined)).toEqual({
      signOption: DEFAULT_JWT_ACCESS_EXPIRES_IN,
      seconds: DEFAULT_JWT_ACCESS_EXPIRES_IN_SECONDS,
    });

    expect(
      resolveJwtAccessExpiry(
        new ConfigService({ JWT_ACCESS_EXPIRES_IN: 'invalid' }),
      ),
    ).toEqual({
      signOption: DEFAULT_JWT_ACCESS_EXPIRES_IN,
      seconds: DEFAULT_JWT_ACCESS_EXPIRES_IN_SECONDS,
    });
  });
});
