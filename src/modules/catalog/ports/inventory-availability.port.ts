import { Injectable } from '@nestjs/common';

export abstract class InventoryAvailabilityPort {
  abstract getAvailableQuantity(skuId: string): Promise<number | null>;
}

@Injectable()
export class UnavailableInventoryAvailabilityAdapter extends InventoryAvailabilityPort {
  async getAvailableQuantity(_skuId: string): Promise<null> {
    return null;
  }
}
