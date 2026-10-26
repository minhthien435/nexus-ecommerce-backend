import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeClientService {
  private readonly logger = new Logger(StripeClientService.name);
  private stripeInstance: Stripe | null = null;

  constructor(private readonly configService: ConfigService) {}

  getClient(): Stripe {
    if (!this.stripeInstance) {
      const apiKey = this.configService
        .get<string>('STRIPE_SECRET_KEY')
        ?.trim();

      if (!apiKey || apiKey === 'sk_test_placeholder') {
        this.logger.error('STRIPE_SECRET_KEY is missing or set to placeholder');
        throw new ServiceUnavailableException(
          'Stripe payment gateway is not configured',
        );
      }

      this.stripeInstance = new Stripe(apiKey);
    }

    return this.stripeInstance;
  }

  constructWebhookEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Missing raw request body for webhook verification',
      );
    }

    if (
      !signature ||
      typeof signature !== 'string' ||
      signature.trim() === ''
    ) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const webhookSecret = this.configService
      .get<string>('STRIPE_WEBHOOK_SECRET')
      ?.trim();

    if (!webhookSecret || webhookSecret === 'whsec_placeholder') {
      this.logger.error(
        'STRIPE_WEBHOOK_SECRET is missing or set to placeholder',
      );
      throw new ServiceUnavailableException(
        'Stripe webhook secret is not configured',
      );
    }

    const stripe = this.getClient();
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(
        `Failed to verify Stripe webhook signature: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        `Invalid Stripe webhook signature: ${(err as Error).message}`,
      );
    }
  }
}
