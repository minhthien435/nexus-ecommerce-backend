import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ShippingWebhookController } from './shipping-webhook.controller.js';
import type { GhnClientService } from '../../fulfillment/services/ghn-client.service.js';
import type { OrderService } from '../services/order.service.js';

describe('ShippingWebhookController', () => {
  let controller: ShippingWebhookController;
  let ghnClient: GhnClientService;
  let orderService: OrderService;

  beforeEach(() => {
    ghnClient = {
      verifyWebhook: vi.fn(),
    } as unknown as GhnClientService;

    orderService = {
      markOrderAsDeliveredViaCarrier: vi.fn(),
    } as unknown as OrderService;

    controller = new ShippingWebhookController(ghnClient, orderService);
  });

  it('ném UnauthorizedException khi chữ ký webhook không hợp lệ', async () => {
    vi.mocked(ghnClient.verifyWebhook).mockReturnValue(false);

    await expect(
      controller.handleGhnWebhook(
        { 'x-ghn-token': 'wrong-token' },
        { OrderCode: 'GHN123', Status: 'delivered' },
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(orderService.markOrderAsDeliveredViaCarrier).not.toHaveBeenCalled();
  });

  it('gọi orderService.markOrderAsDeliveredViaCarrier khi status là delivered', async () => {
    vi.mocked(ghnClient.verifyWebhook).mockReturnValue(true);
    vi.mocked(orderService.markOrderAsDeliveredViaCarrier).mockResolvedValue({
      orderId: 'order-123',
      status: 'DELIVERED',
      trackingCode: 'GHN123',
      alreadyDelivered: false,
      updatedAt: new Date(),
    });

    const response = await controller.handleGhnWebhook(
      { 'x-ghn-token': 'valid-token' },
      { OrderCode: 'GHN123', Status: 'delivered' },
    );

    expect(orderService.markOrderAsDeliveredViaCarrier).toHaveBeenCalledWith(
      'GHN123',
    );
    expect(response.success).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.data).toHaveProperty('status', 'DELIVERED');
  });

  it('không gọi markOrderAsDeliveredViaCarrier khi status là shipping', async () => {
    vi.mocked(ghnClient.verifyWebhook).mockReturnValue(true);

    const response = await controller.handleGhnWebhook(
      { 'x-ghn-token': 'valid-token' },
      { OrderCode: 'GHN123', Status: 'shipping' },
    );

    expect(orderService.markOrderAsDeliveredViaCarrier).not.toHaveBeenCalled();
    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      orderCode: 'GHN123',
      status: 'shipping',
    });
  });
});
