import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Webhook } from '@payos/node';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import {
  CreatePayosPaymentLinkDto,
  CreatePayosPaymentLinkResult,
} from '../dtos/create-payos-payment-link.dto.js';
import { PaymentsService } from '../services/payments.service.js';
import {
  PaymentWebhookService,
  WebhookProcessingResult,
} from '../services/payment-webhook.service.js';

@Controller('api/v1/commerce/payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentWebhookService: PaymentWebhookService,
  ) {}

  @Post('payos/create-link')
  @UseGuards(AccessTokenGuard)
  createPayosLink(
    @CurrentUserId() userId: string,
    @Body() dto: CreatePayosPaymentLinkDto,
  ): Promise<CreatePayosPaymentLinkResult> {
    return this.paymentsService.createPayosPaymentLink(userId, dto);
  }

  @Post('payos/webhook')
  @HttpCode(HttpStatus.OK)
  handlePayosWebhook(@Body() body: Webhook): Promise<WebhookProcessingResult> {
    return this.paymentWebhookService.handlePayosWebhook(body);
  }
}
