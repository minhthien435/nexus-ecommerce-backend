import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CreatePaymentLinkRequest } from '@payos/node';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, type EntityManager } from 'typeorm';
import { CoinService } from '../../coin/coin.service.js';
import { coinDiscountCents, coinLimit } from '../../coin/coin-policy.js';
import { centsToMoney, moneyToCents } from './cart-money.js';
import {
  CreatePayosPaymentLinkDto,
  CreatePayosPaymentLinkResult,
} from '../dtos/create-payos-payment-link.dto.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import {
  formatPayosDescription,
  generatePayosOrderCode,
} from '../utils/payos-order-code.util.js';
import { PayosClientService } from './payos-client.service.js';

const AUCTION_LINK_MIN_SECONDS = 60;
const PAYOS_ATTEMPT_LEASE_MS = 60_000;

type PaymentSetup =
  | { result: CreatePayosPaymentLinkResult }
  | {
      order: OrderEntity;
      payment: PaymentEntity;
      request: CreatePaymentLinkRequest & { expiredAt: number };
    };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly payosClientService: PayosClientService,
    private readonly configService: ConfigService,
  ) {}

  async createPayosPaymentLink(
    buyerId: string,
    dto: CreatePayosPaymentLinkDto,
  ): Promise<CreatePayosPaymentLinkResult> {
    if (!this.payosClientService) {
      throw new ServiceUnavailableException('PayOS service is not available');
    }

    let setup: PaymentSetup;
    try {
      setup = await this.dataSource.transaction((manager) =>
        this.preparePayment(manager, buyerId, dto),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Payment attempt already exists');
      }
      throw error;
    }
    if ('result' in setup) return setup.result;

    const { order, payment, request } = setup;
    let link;
    try {
      link = await this.payosClientService.createPaymentLink(request);
    } catch (error) {
      this.logger.error(
        `PayOS link creation failed for order ${order.id}`,
        error,
      );
      await this.markSetupFailed(payment.id);
      throw new ServiceUnavailableException(
        'Failed to create PayOS payment link',
      );
    }

    const result = {
      paymentId: payment.id,
      orderId: order.id,
      orderCode: request.orderCode,
      paymentLinkId: link.paymentLinkId,
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      amount: request.amount,
      payableAmount: request.amount,
      coinDiscountAmount: Number(order.discountAmount ?? 0),
      currency: 'VND',
      status: 'PENDING',
    };
    try {
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(OrderEntity).findOne({
          where: { id: order.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          current?.status !== 'PENDING_PAYMENT' ||
          (current.source === 'AUCTION' &&
            Date.now() >= request.expiredAt * 1000)
        ) {
          throw new ConflictException('The order is no longer payable');
        }
        const update = await manager
          .getRepository(PaymentEntity)
          .update(
            { id: payment.id, status: 'INITIATED' },
            { status: 'PENDING', failureReason: JSON.stringify(result) },
          );
        if (update.affected !== 1) {
          throw new ConflictException(
            'The payment attempt is no longer active',
          );
        }
      });
    } catch (error) {
      try {
        await this.payosClientService.cancelPaymentLink(
          request.orderCode,
          'Payment setup failed',
        );
      } catch (cancelError) {
        this.logger.error(
          `Could not cancel PayOS link ${request.orderCode}`,
          cancelError,
        );
      }
      await this.markSetupFailed(payment.id);
      throw error;
    }
    return result;
  }

  private async preparePayment(
    manager: EntityManager,
    buyerId: string,
    dto: CreatePayosPaymentLinkDto,
  ): Promise<PaymentSetup> {
    const orderRepository = manager.getRepository(OrderEntity);
    const paymentRepository = manager.getRepository(PaymentEntity);
    const order = await orderRepository.findOne({
      where: { id: dto.orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException(`Order with id '${dto.orderId}' not found`);
    }

    // 2. Ownership verification
    if (order.buyerId.toLowerCase() !== buyerId.toLowerCase()) {
      throw new ForbiddenException(
        'You do not have permission to pay for this order',
      );
    }

    // 3. Status verification
    if (order.status !== 'PENDING_PAYMENT') {
      if (order.status === 'PAID') {
        throw new ConflictException('Order has already been paid');
      }
      throw new BadRequestException(
        `Order cannot be paid in current status: ${order.status}`,
      );
    }

    // 4. Authoritative amount & currency validation directly from DB
    const numericTotal = Number(order.total);
    if (isNaN(numericTotal) || numericTotal <= 0) {
      throw new BadRequestException('Order total must be greater than 0');
    }
    let payosAmount = Math.round(numericTotal);

    const currency = order.currency?.toUpperCase().trim();
    if (currency !== 'VND') {
      throw new BadRequestException(
        `PayOS only supports VND currency, but order has currency '${order.currency}'`,
      );
    }

    if (order.source !== 'AUCTION' && dto.useCoins !== undefined) {
      throw new BadRequestException('For cart orders, select Coin at checkout');
    }
    const holdExpiresSeconds = order.holdExpiresAt
      ? Math.floor(new Date(order.holdExpiresAt).getTime() / 1000)
      : 0;
    if (
      order.source === 'AUCTION' &&
      holdExpiresSeconds &&
      holdExpiresSeconds <= Math.floor(Date.now() / 1000)
    ) {
      throw new ConflictException('The auction payment deadline has passed');
    }

    // 5. Client Idempotency Key check
    if (dto.idempotencyKey) {
      const existingByKey = await paymentRepository.findOne({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (existingByKey) {
        if (existingByKey.orderId !== order.id) {
          throw new ConflictException(
            'Idempotency key has already been used for a different order',
          );
        }
        if (existingByKey.status === 'SUCCEEDED') {
          throw new ConflictException('Order has already been paid');
        }
        if (existingByKey.status === 'CANCELLED') {
          throw new ConflictException(
            `Payment attempt with this idempotency key has already ${existingByKey.status.toLowerCase()}`,
          );
        }

        this.assertCoinSelection(order, dto.useCoins);

        // Failed setup never published a link. Free the key for a retry on this order.
        if (existingByKey.status === 'FAILED') {
          await paymentRepository.update(existingByKey.id, {
            idempotencyKey: null,
          });
        } else if (existingByKey.failureReason) {
          try {
            const cached = JSON.parse(existingByKey.failureReason) as {
              orderCode: number;
              paymentLinkId: string;
              checkoutUrl: string;
              qrCode: string;
            };
            if (cached.checkoutUrl && cached.orderCode) {
              return {
                result: {
                  paymentId: existingByKey.id,
                  orderId: order.id,
                  orderCode: cached.orderCode,
                  paymentLinkId: cached.paymentLinkId,
                  checkoutUrl: cached.checkoutUrl,
                  qrCode: cached.qrCode,
                  amount: payosAmount,
                  payableAmount: payosAmount,
                  coinDiscountAmount: Number(order.discountAmount ?? 0),
                  currency: 'VND',
                  status: existingByKey.status,
                },
              };
            }
          } catch {
            // Ignore parse error and proceed
          }
        }
      }
    }

    // 6. Check for active PayOS payment attempt on this order
    let activePayment = await paymentRepository.findOne({
      where: {
        orderId: order.id,
        provider: 'PAYOS',
        status: In(['INITIATED', 'PENDING']),
      },
      order: { createdAt: 'DESC' },
    });

    if (activePayment) this.assertCoinSelection(order, dto.useCoins);
    if (activePayment?.status === 'INITIATED') {
      if (
        Date.now() - activePayment.createdAt.getTime() <
        PAYOS_ATTEMPT_LEASE_MS
      ) {
        throw new ConflictException({
          errorCode: 'PAYOS_LINK_IN_PROGRESS',
          message: 'A PayOS payment link is already being created',
        });
      }
      // A timed-out reservation never published a URL. Keep its provider code
      // for reconciliation if a delayed callback still arrives.
      await paymentRepository.update(activePayment.id, {
        status: 'FAILED',
        idempotencyKey: null,
        failureReason: 'Link setup reservation expired',
      });
      activePayment = null;
    }

    if (
      activePayment?.providerPaymentId &&
      activePayment.failureReason &&
      Math.round(Number(activePayment.amount)) === payosAmount
    ) {
      try {
        const cached = JSON.parse(activePayment.failureReason) as {
          orderCode: number;
          paymentLinkId: string;
          checkoutUrl: string;
          qrCode: string;
        };
        if (cached.checkoutUrl && cached.orderCode) {
          return {
            result: {
              paymentId: activePayment.id,
              orderId: order.id,
              orderCode: cached.orderCode,
              paymentLinkId: cached.paymentLinkId,
              checkoutUrl: cached.checkoutUrl,
              qrCode: cached.qrCode,
              amount: payosAmount,
              payableAmount: payosAmount,
              coinDiscountAmount: Number(order.discountAmount ?? 0),
              currency: 'VND',
              status: activePayment.status,
            },
          };
        }
      } catch {
        // Fall through to create a new link
      }
    }

    if (
      order.source === 'AUCTION' &&
      holdExpiresSeconds > 0 &&
      holdExpiresSeconds - Math.floor(Date.now() / 1000) <
        AUCTION_LINK_MIN_SECONDS
    ) {
      throw new ConflictException({
        errorCode: 'AUCTION_PAYMENT_DEADLINE_TOO_CLOSE',
        message: 'At least 60 seconds must remain to create a new PayOS link',
      });
    }

    if (activePayment) {
      throw new ConflictException(
        'An active PayOS link already exists for this order',
      );
    }

    // 7. Calculate attempt number
    const previousAttempts = await paymentRepository.count({
      where: { orderId: order.id },
    });
    const attemptNo = previousAttempts + 1;
    if (
      dto.useCoins !== undefined &&
      !activePayment &&
      previousAttempts === 0
    ) {
      const totalCents = moneyToCents(order.total);
      if (dto.useCoins > coinLimit(moneyToCents(order.subtotal), totalCents)) {
        throw new BadRequestException({
          errorCode: 'COIN_DISCOUNT_LIMIT_EXCEEDED',
          message: 'The requested Coin discount exceeds the order limit',
        });
      }
      if (dto.useCoins > 0) {
        const discount = coinDiscountCents(dto.useCoins);
        await CoinService.redeem(
          manager,
          order.buyerId,
          order.id,
          dto.useCoins,
        );
        order.discountAmount = centsToMoney(discount);
        order.total = centsToMoney(totalCents - discount);
        await orderRepository.save(order);
        payosAmount = Math.round(Number(order.total));
      }
    } else {
      this.assertCoinSelection(order, dto.useCoins);
    }

    // 8. Generate unique safe integer orderCode
    const orderCode = generatePayosOrderCode();

    // 9. Prepare and invoke PayOS SDK
    const description = formatPayosDescription(order.orderNumber);
    const cancelUrl =
      this.configService.get<string>('PAYOS_CANCEL_URL')?.trim() ||
      'http://localhost:5173/checkout/payment-result';
    const returnUrl =
      this.configService.get<string>('PAYOS_RETURN_URL')?.trim() ||
      'http://localhost:5173/checkout/payment-result';

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expiredAt =
      order.source === 'AUCTION' && holdExpiresSeconds
        ? holdExpiresSeconds
        : holdExpiresSeconds > nowInSeconds + 60
          ? holdExpiresSeconds
          : nowInSeconds + 15 * 60;

    const payment = await paymentRepository.save(
      paymentRepository.create({
        orderId: order.id,
        checkoutSessionId: order.checkoutSessionId,
        provider: 'PAYOS',
        providerPaymentId: String(orderCode),
        amount: String(payosAmount),
        currency: 'VND',
        status: 'INITIATED',
        attemptNo,
        idempotencyKey: dto.idempotencyKey ?? null,
      }),
    );

    return {
      order,
      payment,
      request: {
        orderCode,
        amount: payosAmount,
        description,
        cancelUrl,
        returnUrl,
        expiredAt,
      },
    };
  }

  private async markSetupFailed(paymentId: string): Promise<void> {
    try {
      await this.dataSource
        .getRepository(PaymentEntity)
        .update(
          { id: paymentId, status: 'INITIATED' },
          { status: 'FAILED', failureReason: 'PayOS link setup failed' },
        );
    } catch (error) {
      this.logger.error(`Could not mark payment ${paymentId} as failed`, error);
    }
  }

  private assertCoinSelection(order: OrderEntity, useCoins?: number): void {
    if (
      useCoins !== undefined &&
      coinDiscountCents(useCoins) !== moneyToCents(order.discountAmount)
    ) {
      throw new ConflictException({
        errorCode: 'COIN_SELECTION_LOCKED',
        message: 'The Coin selection is locked after creating the PayOS link',
      });
    }
  }
}
