import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { CreatePaymentIntentDto } from '../dtos/create-payment-intent.dto.js';
import {
  CreatePaymentIntentResult,
  PaymentsService,
} from '../services/payments.service.js';
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

  @Post('stripe/create-intent')
  @UseGuards(AccessTokenGuard)
  createIntent(
    @CurrentUserId() userId: string,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<CreatePaymentIntentResult> {
    return this.paymentsService.createPaymentIntent(userId, dto);
  }

  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<WebhookProcessingResult> {
    return this.paymentWebhookService.handleWebhook(req.rawBody, signature);
  }
}
