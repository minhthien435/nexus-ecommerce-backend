import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsController } from './payments.controller.js';
import {
  CreatePaymentIntentResult,
  PaymentsService,
} from '../services/payments.service.js';
import {
  PaymentWebhookService,
  WebhookProcessingResult,
} from '../services/payment-webhook.service.js';
import { CreatePaymentIntentDto } from '../dtos/create-payment-intent.dto.js';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: PaymentsService;
  let paymentWebhookService: PaymentWebhookService;

  beforeEach(() => {
    paymentsService = {
      createPaymentIntent: vi.fn(),
    } as unknown as PaymentsService;
    paymentWebhookService = {
      handleWebhook: vi.fn(),
    } as unknown as PaymentWebhookService;
    controller = new PaymentsController(paymentsService, paymentWebhookService);
  });

  it('delegates createIntent to PaymentsService with authenticated userId and dto', async () => {
    const userId = 'user-uuid-1';
    const dto: CreatePaymentIntentDto = {
      orderId: 'order-uuid-1',
    };
    const expectedResult: CreatePaymentIntentResult = {
      paymentId: 'payment-uuid-1',
      orderId: 'order-uuid-1',
      paymentIntentId: 'pi_123',
      clientSecret: 'pi_123_secret',
      amount: '550000.00',
      currency: 'VND',
      status: 'INITIATED',
    };

    vi.mocked(paymentsService.createPaymentIntent).mockResolvedValue(
      expectedResult,
    );

    const result = await controller.createIntent(userId, dto);

    expect(paymentsService.createPaymentIntent).toHaveBeenCalledWith(
      userId,
      dto,
    );
    expect(result).toBe(expectedResult);
  });

  it('delegates handleWebhook to PaymentWebhookService with rawBody and signature', async () => {
    const rawBody = Buffer.from('{"id":"evt_123"}');
    const signature = 't=123,v1=abc';
    const mockReq = { rawBody } as RawBodyRequest<Request>;
    const expectedResult: WebhookProcessingResult = { received: true };

    vi.mocked(paymentWebhookService.handleWebhook).mockResolvedValue(
      expectedResult,
    );

    const result = await controller.handleWebhook(mockReq, signature);

    expect(paymentWebhookService.handleWebhook).toHaveBeenCalledWith(
      rawBody,
      signature,
    );
    expect(result).toBe(expectedResult);
  });
});
