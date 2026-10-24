import { Test } from '@nestjs/testing';
import {
  ORDER_INVENTORY_RELEASE_ADAPTER,
  ORDER_INVENTORY_RELEASE_PROVIDERS,
  OrderInventoryReleasePort,
  UnavailableOrderInventoryReleaseAdapter,
} from './order-inventory-release.port.js';

describe('OrderInventoryReleasePort providers', () => {
  it('uses a configured adapter without requiring Commerce source changes', async () => {
    const configured = { release: vi.fn() };
    const module = await Test.createTestingModule({
      providers: [
        { provide: ORDER_INVENTORY_RELEASE_ADAPTER, useValue: configured },
        ...ORDER_INVENTORY_RELEASE_PROVIDERS,
      ],
    }).compile();

    expect(module.get(OrderInventoryReleasePort)).toBe(configured);
  });

  it('fails closed when no inventory adapter is configured', async () => {
    const module = await Test.createTestingModule({
      providers: [...ORDER_INVENTORY_RELEASE_PROVIDERS],
    }).compile();
    const port = module.get(OrderInventoryReleasePort);

    expect(port).toBeInstanceOf(UnavailableOrderInventoryReleaseAdapter);
    await expect(
      port.release({ orderId: 'order-id', items: [] }, {} as never),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        errorCode: 'ORDER_INVENTORY_RELEASE_UNAVAILABLE',
      }),
    });
  });
});
