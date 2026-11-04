import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RecaptchaResponse = {
  success?: boolean;
  hostname?: string;
};

@Injectable()
export class RecaptchaService {
  constructor(private readonly config: ConfigService) {}

  async verify(token?: string, remoteIp?: string): Promise<void> {
    if (!token) {
      return;
    }
    if (
      this.config.get<string>('NODE_ENV') !== 'production' &&
      token === 'bypass-recaptcha-dev'
    ) {
      return;
    }

    const secret = this.config.get<string>('RECAPTCHA_SECRET_KEY');
    if (!secret) {
      throw new InternalServerErrorException(
        'Captcha verification is unavailable',
      );
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let response: Response;
    try {
      response = await fetch(
        'https://www.google.com/recaptcha/api/siteverify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Captcha verification is unavailable',
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Captcha verification is unavailable',
      );
    }

    let result: RecaptchaResponse;
    try {
      result = (await response.json()) as RecaptchaResponse;
    } catch {
      throw new ServiceUnavailableException(
        'Captcha verification is unavailable',
      );
    }
    const expectedHostname = this.config.get<string>(
      'RECAPTCHA_EXPECTED_HOSTNAME',
    );
    if (
      !result.success ||
      (expectedHostname && result.hostname !== expectedHostname)
    ) {
      throw new BadRequestException('Captcha verification failed');
    }
  }
}
