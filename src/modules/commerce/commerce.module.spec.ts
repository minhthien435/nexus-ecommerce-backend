import { CommerceModule } from './commerce.module.js';
import { OrderExpiryOutboxApi } from './order-expiry-outbox.api.js';
import { OrderExpiryTransitionApi } from './order-expiry-transition.api.js';
import { OrderExpiryProcessor } from './processors/order-expiry.processor.js';
import { OrderExpiryOutboxService } from './services/order-expiry-outbox.service.js';
import { OrderStateMachineService } from './services/order-state-machine.service.js';
import { SupportOrderController } from './controllers/support-order.controller.js';
import { SupportOrderService } from './services/support-order.service.js';

describe('CommerceModule expiry wiring', () => {
  it('registers the processor and binds expiry ports to production services', () => {
    const providers = Reflect.getMetadata('providers', CommerceModule) as Array<
      Function | { provide: unknown; useExisting?: unknown }
    >;
    expect(providers).toContain(OrderExpiryProcessor);
    expect(providers).toContain(OrderExpiryOutboxService);
    expect(providers).toContain(SupportOrderService);
    expect(providers).toContainEqual({
      provide: OrderExpiryOutboxApi,
      useExisting: OrderExpiryOutboxService,
    });
    expect(providers).toContainEqual({
      provide: OrderExpiryTransitionApi,
      useExisting: OrderStateMachineService,
    });
  });

  it('registers the support order read surface', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      CommerceModule,
    ) as Function[];
    expect(controllers).toContain(SupportOrderController);
  });
});
