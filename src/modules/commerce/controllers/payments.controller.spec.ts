import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Webhook } from '@payos/node';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from '../services/payments.service.js';
import {
  PaymentWebhookService,
  WebhookProcessingResult,
} from '../services/payment-webhook.service.js';
import {
  CreatePayosPaymentLinkDto,
  CreatePayosPaymentLinkResult,
} from '../dtos/create-payos-payment-link.dto.js';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: PaymentsService;
  let paymentWebhookService: PaymentWebhookService;

  beforeEach(() => {
    paymentsService = {
      createPayosPaymentLink: vi.fn(),
    } as unknown as PaymentsService;
    paymentWebhookService = {
      handlePayosWebhook: vi.fn(),
    } as unknown as PaymentWebhookService;
    controller = new PaymentsController(paymentsService, paymentWebhookService);
  });

  it('delegates createPayosLink to PaymentsService with authenticated userId and dto', async () => {
    const userId = 'user-uuid-1';
    const dto: CreatePayosPaymentLinkDto = {
      orderId: 'order-uuid-1',
    };
    const expectedResult: CreatePayosPaymentLinkResult = {
      paymentId: 'payment-uuid-payos',
      orderId: 'order-uuid-1',
      orderCode: 123456789,
      paymentLinkId: 'link_123',
      checkoutUrl: 'https://pay.payos.vn/web/123',
      qrCode: 'vietqr_string',
      amount: 550000,
      currency: 'VND',
      status: 'PENDING',
    };

    vi.mocked(paymentsService.createPayosPaymentLink).mockResolvedValue(
      expectedResult,
    );

    const result = await controller.createPayosLink(userId, dto);

    expect(paymentsService.createPayosPaymentLink).toHaveBeenCalledWith(
      userId,
      dto,
    );
    expect(result).toBe(expectedResult);
  });

  it('delegates handlePayosWebhook to PaymentWebhookService with payload body', async () => {
    const webhookBody: Webhook = {
      code: '00',
      desc: 'success',
      success: true,
      data: {
        orderCode: 123456,
        amount: 50000,
        description: 'Don hang test',
        accountNumber: '123456789',
        reference: 'TF123',
        transactionDateTime: '2026-11-02 08:00:00',
        currency: 'VND',
        paymentLinkId: 'link_123',
        code: '00',
        desc: 'success',
      },
      signature: 'valid_signature',
    };
    const expectedResult: WebhookProcessingResult = { received: true };

    vi.mocked(paymentWebhookService.handlePayosWebhook).mockResolvedValue(
      expectedResult,
    );

    const result = await controller.handlePayosWebhook(webhookBody);

    expect(paymentWebhookService.handlePayosWebhook).toHaveBeenCalledWith(
      webhookBody,
    );
    expect(result).toBe(expectedResult);
  });
});
