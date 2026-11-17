import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

    return this.dataSource.transaction((manager) =>
      this.createLockedPaymentLink(manager, buyerId, dto),
    );
  }

  private async createLockedPaymentLink(
    manager: EntityManager,
    buyerId: string,
    dto: CreatePayosPaymentLinkDto,
  ): Promise<CreatePayosPaymentLinkResult> {
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
        if (
          existingByKey.status === 'FAILED' ||
          existingByKey.status === 'CANCELLED'
        ) {
          throw new ConflictException(
            `Payment attempt with this idempotency key has already ${existingByKey.status.toLowerCase()}`,
          );
        }

        this.assertCoinSelection(order, dto.useCoins);

        // Return existing payment link data if cached in failureReason
        if (existingByKey.failureReason) {
          try {
            const cached = JSON.parse(existingByKey.failureReason) as {
              orderCode: number;
              paymentLinkId: string;
              checkoutUrl: string;
              qrCode: string;
            };
            if (cached.checkoutUrl && cached.orderCode) {
              return {
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
              };
            }
          } catch {
            // Ignore parse error and proceed
          }
        }
      }
    }

    // 6. Check for active PayOS payment attempt on this order
    const activePayment = await paymentRepository.findOne({
      where: {
        orderId: order.id,
        provider: 'PAYOS',
        status: In(['INITIATED', 'PENDING']),
      },
      order: { createdAt: 'DESC' },
    });

    if (activePayment) this.assertCoinSelection(order, dto.useCoins);

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
          };
        }
      } catch {
        // Fall through to create a new link
      }
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

    let payosResponse;
    try {
      payosResponse = await this.payosClientService.createPaymentLink({
        orderCode,
        amount: payosAmount,
        description,
        cancelUrl,
        returnUrl,
        expiredAt,
      });
    } catch (payosError) {
      const errorMsg = (payosError as Error)?.message || 'PayOS API error';
      this.logger.error(
        `Failed to create PayOS payment link for order ${order.id}: ${errorMsg}`,
      );
      throw new ServiceUnavailableException(
        `Failed to create PayOS payment link: ${errorMsg}`,
      );
    }

    // 10. Persist payment record
    const payment = paymentRepository.create({
      orderId: order.id,
      checkoutSessionId: order.checkoutSessionId,
      provider: 'PAYOS',
      providerPaymentId: String(orderCode),
      amount: String(payosAmount),
      currency: 'VND',
      status: 'PENDING',
      attemptNo,
      idempotencyKey: dto.idempotencyKey ?? null,
      failureReason: JSON.stringify({
        orderCode,
        paymentLinkId: payosResponse.paymentLinkId,
        checkoutUrl: payosResponse.checkoutUrl,
        qrCode: payosResponse.qrCode,
      }),
    });

    try {
      await paymentRepository.save(payment);
    } catch (error) {
      this.logger.error(
        `PayOS link ${orderCode} was created but its payment record could not be saved: ${(error as Error).message}`,
      );
      try {
        await this.payosClientService.cancelPaymentLink(
          orderCode,
          'Payment setup failed',
        );
      } catch (cancelError) {
        this.logger.error(
          `Could not cancel PayOS link ${orderCode}: ${(cancelError as Error).message}`,
        );
      }
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Payment attempt already exists');
      }
      throw error;
    }

    return {
      paymentId: payment.id,
      orderId: order.id,
      orderCode,
      paymentLinkId: payosResponse.paymentLinkId,
      checkoutUrl: payosResponse.checkoutUrl,
      qrCode: payosResponse.qrCode,
      amount: payosAmount,
      payableAmount: payosAmount,
      coinDiscountAmount: Number(order.discountAmount ?? 0),
      currency: 'VND',
      status: payment.status,
    };
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
