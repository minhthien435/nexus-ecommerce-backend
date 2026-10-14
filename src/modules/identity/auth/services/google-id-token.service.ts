import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  fullName: string;
};

@Injectable()
export class GoogleIdTokenService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verify(credential: string): Promise<VerifiedGoogleIdentity> {
    const audience = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience) {
      throw new InternalServerErrorException('Google login is unavailable');
    }
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new UnauthorizedException('Invalid Google credential');
      }
      return {
        subject: payload.sub,
        email: payload.email.toLowerCase(),
        fullName: (payload.name?.trim() || payload.email).slice(0, 150),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid Google credential');
    }
  }
}
