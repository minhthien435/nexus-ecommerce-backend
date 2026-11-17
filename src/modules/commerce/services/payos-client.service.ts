import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PayOS,
  type CreatePaymentLinkRequest,
  type CreatePaymentLinkResponse,
  type PaymentLink,
  type Webhook,
  type WebhookData,
} from '@payos/node';

@Injectable()
export class PayosClientService {
  private readonly logger = new Logger(PayosClientService.name);
  private payosInstance: PayOS | null = null;

  constructor(private readonly configService: ConfigService) {}

  getClient(): PayOS {
    if (!this.payosInstance) {
      const clientId = this.configService
        .get<string>('PAYOS_CLIENT_ID')
        ?.trim();
      const apiKey = this.configService.get<string>('PAYOS_API_KEY')?.trim();
      const checksumKey = this.configService
        .get<string>('PAYOS_CHECKSUM_KEY')
        ?.trim();

      if (!clientId) {
        this.logger.error('PAYOS_CLIENT_ID is missing or not configured');
        throw new ServiceUnavailableException(
          'PayOS payment gateway is not configured: missing PAYOS_CLIENT_ID',
        );
      }

      if (!apiKey) {
        this.logger.error('PAYOS_API_KEY is missing or not configured');
        throw new ServiceUnavailableException(
          'PayOS payment gateway is not configured: missing PAYOS_API_KEY',
        );
      }

      if (!checksumKey) {
        this.logger.error('PAYOS_CHECKSUM_KEY is missing or not configured');
        throw new ServiceUnavailableException(
          'PayOS payment gateway is not configured: missing PAYOS_CHECKSUM_KEY',
        );
      }

      try {
        this.payosInstance = new PayOS({
          clientId,
          apiKey,
          checksumKey,
        });
      } catch (err) {
        const errorMsg = (err as Error)?.message || 'Unknown error';
        this.logger.error(`Failed to initialize PayOS client: ${errorMsg}`);
        throw new ServiceUnavailableException(
          `Failed to initialize PayOS client: ${errorMsg}`,
        );
      }
    }

    return this.payosInstance;
  }

  async createPaymentLink(
    paymentData: CreatePaymentLinkRequest,
  ): Promise<CreatePaymentLinkResponse> {
    const client = this.getClient();
    return client.paymentRequests.create(paymentData, {
      timeout: 15_000,
      maxRetries: 0,
    });
  }

  async verifyWebhook(webhook: Webhook): Promise<WebhookData> {
    const client = this.getClient();
    return client.webhooks.verify(webhook);
  }

  async cancelPaymentLink(
    orderCodeOrLinkId: number | string,
    cancellationReason?: string,
  ): Promise<PaymentLink> {
    const client = this.getClient();
    if (typeof orderCodeOrLinkId === 'number') {
      return client.paymentRequests.cancel(
        orderCodeOrLinkId,
        cancellationReason,
      );
    }
    const numericCode = Number(orderCodeOrLinkId);
    if (!Number.isNaN(numericCode) && Number.isSafeInteger(numericCode)) {
      return client.paymentRequests.cancel(numericCode, cancellationReason);
    }
    return client.paymentRequests.cancel(orderCodeOrLinkId, cancellationReason);
  }

  async getPaymentLink(
    orderCodeOrLinkId: number | string,
  ): Promise<PaymentLink> {
    const client = this.getClient();
    if (typeof orderCodeOrLinkId === 'number') {
      return client.paymentRequests.get(orderCodeOrLinkId);
    }
    const numericCode = Number(orderCodeOrLinkId);
    if (!Number.isNaN(numericCode) && Number.isSafeInteger(numericCode)) {
      return client.paymentRequests.get(numericCode);
    }
    return client.paymentRequests.get(orderCodeOrLinkId);
  }
}
