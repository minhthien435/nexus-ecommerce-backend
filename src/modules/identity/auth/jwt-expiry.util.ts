import type { ConfigService } from '@nestjs/config';
import type { JwtSignOptions } from '@nestjs/jwt';

export const DEFAULT_JWT_ACCESS_EXPIRES_IN = '8h';
export const DEFAULT_JWT_ACCESS_EXPIRES_IN_SECONDS = 8 * 60 * 60;

const DURATION_UNITS_IN_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

export interface AccessTokenExpiry {
  signOption: JwtSignOptions['expiresIn'];
  seconds: number;
}

/**
 * Đọc JWT_ACCESS_EXPIRES_IN từ ConfigService (hỗ trợ `'8h'`, `'15m'`, `'30s'`, `'1d'`, `'1w'` hoặc số giây),
 * đồng bộ cho cả JwtService/JwtModule và trường `expiresIn` trả về ở AuthController.
 */
export function resolveJwtAccessExpiry(
  config?: ConfigService,
): AccessTokenExpiry {
  const raw = config?.get<string | number>('JWT_ACCESS_EXPIRES_IN');
  const normalized =
    raw === undefined || raw === null ? '' : String(raw).trim();
  const candidate = normalized || DEFAULT_JWT_ACCESS_EXPIRES_IN;

  if (/^\d+$/.test(candidate)) {
    const seconds = Number(candidate);
    if (Number.isSafeInteger(seconds) && seconds > 0) {
      return { signOption: seconds, seconds };
    }
  }

  const match = /^(\d+)\s*([smhdw])$/i.exec(candidate);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const totalSeconds = amount * DURATION_UNITS_IN_SECONDS[unit];
    if (Number.isSafeInteger(totalSeconds) && totalSeconds > 0) {
      return {
        signOption: `${amount}${unit}` as JwtSignOptions['expiresIn'],
        seconds: totalSeconds,
      };
    }
  }

  return {
    signOption: DEFAULT_JWT_ACCESS_EXPIRES_IN,
    seconds: DEFAULT_JWT_ACCESS_EXPIRES_IN_SECONDS,
  };
}
