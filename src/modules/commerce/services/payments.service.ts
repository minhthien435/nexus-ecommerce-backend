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
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
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

    // 1. Authoritative order retrieval
    const order = await this.orderRepository.findOne({
      where: { id: dto.orderId },
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
    const payosAmount = Math.round(numericTotal);

    const currency = order.currency?.toUpperCase().trim();
    if (currency !== 'VND') {
      throw new BadRequestException(
        `PayOS only supports VND currency, but order has currency '${order.currency}'`,
      );
    }

    // 5. Client Idempotency Key check
    if (dto.idempotencyKey) {
      const existingByKey = await this.paymentRepository.findOne({
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
    const activePayment = await this.paymentRepository.findOne({
      where: {
        orderId: order.id,
        provider: 'PAYOS',
        status: In(['INITIATED', 'PENDING']),
      },
      order: { createdAt: 'DESC' },
    });

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
            currency: 'VND',
            status: activePayment.status,
          };
        }
      } catch {
        // Fall through to create a new link
      }
    }

    // 7. Calculate attempt number
    const previousAttempts = await this.paymentRepository.count({
      where: { orderId: order.id },
    });
    const attemptNo = previousAttempts + 1;

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
    const holdExpiresSeconds = order.holdExpiresAt
      ? Math.floor(new Date(order.holdExpiresAt).getTime() / 1000)
      : 0;
    const expiredAt =
      holdExpiresSeconds > nowInSeconds + 60
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
    const payment = this.paymentRepository.create({
      orderId: order.id,
      checkoutSessionId: order.checkoutSessionId,
      provider: 'PAYOS',
      providerPaymentId: String(orderCode),
      amount: order.total,
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
      await this.paymentRepository.save(payment);
    } catch (dbError) {
      const pgCode = (dbError as { code?: string })?.code;
      if (pgCode === '23505') {
        this.logger.warn(
          `Unique constraint violation (23505) on PayOS payment persistence for order ${order.id}. Recovering record.`,
        );
        const recovered = await this.paymentRepository.findOne({
          where: [
            { providerPaymentId: String(orderCode) },
            ...(dto.idempotencyKey
              ? [{ idempotencyKey: dto.idempotencyKey }]
              : []),
          ],
        });
        if (recovered) {
          return {
            paymentId: recovered.id,
            orderId: order.id,
            orderCode,
            paymentLinkId: payosResponse.paymentLinkId,
            checkoutUrl: payosResponse.checkoutUrl,
            qrCode: payosResponse.qrCode,
            amount: payosAmount,
            currency: 'VND',
            status: recovered.status,
          };
        }
      }

      this.logger.error(
        `PayOS paymentLink created (${orderCode}), but DB save failed: ${(dbError as Error).message}`,
        (dbError as Error).stack,
      );
      throw dbError;
    }

    return {
      paymentId: payment.id,
      orderId: order.id,
      orderCode,
      paymentLinkId: payosResponse.paymentLinkId,
      checkoutUrl: payosResponse.checkoutUrl,
      qrCode: payosResponse.qrCode,
      amount: payosAmount,
      currency: 'VND',
      status: payment.status,
    };
  }
}
