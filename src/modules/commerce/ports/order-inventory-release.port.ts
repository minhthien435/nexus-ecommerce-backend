import {
  Injectable,
  ServiceUnavailableException,
  type Provider,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export interface OrderInventoryReleaseItem {
  skuId: string;
  quantity: number;
}

export interface OrderInventoryRelease {
  orderId: string;
  items: readonly OrderInventoryReleaseItem[];
}

export abstract class OrderInventoryReleasePort {
  abstract release(
    input: OrderInventoryRelease,
    manager: EntityManager,
  ): Promise<void>;
}

export const ORDER_INVENTORY_RELEASE_ADAPTER = Symbol(
  'ORDER_INVENTORY_RELEASE_ADAPTER',
);

@Injectable()
export class UnavailableOrderInventoryReleaseAdapter extends OrderInventoryReleasePort {
  async release(
    _input: OrderInventoryRelease,
    _manager: EntityManager,
  ): Promise<void> {
    throw new ServiceUnavailableException({
      errorCode: 'ORDER_INVENTORY_RELEASE_UNAVAILABLE',
      message: 'Order inventory release is not configured',
    });
  }
}

export const ORDER_INVENTORY_RELEASE_PROVIDERS: Provider[] = [
  UnavailableOrderInventoryReleaseAdapter,
  {
    provide: OrderInventoryReleasePort,
    inject: [
      { token: ORDER_INVENTORY_RELEASE_ADAPTER, optional: true },
      UnavailableOrderInventoryReleaseAdapter,
    ],
    useFactory: (
      configured: OrderInventoryReleasePort | undefined,
      unavailable: UnavailableOrderInventoryReleaseAdapter,
    ) => configured ?? unavailable,
  },
];
