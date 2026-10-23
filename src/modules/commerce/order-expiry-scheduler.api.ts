export abstract class OrderExpirySchedulerApi {
  abstract schedule(orderId: string, holdExpiresAt: Date): Promise<void>;
}
