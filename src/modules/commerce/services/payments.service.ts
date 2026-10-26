import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { CreatePaymentIntentDto } from '../dtos/create-payment-intent.dto.js';
import { toStripeAmount } from '../utils/stripe-amount.util.js';
import { StripeClientService } from './stripe-client.service.js';

export interface CreatePaymentIntentResult {
  paymentId: string;
  orderId: string;
  paymentIntentId: string;
  clientSecret: string;
  amount: string;
  currency: string;
  status: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
    private readonly stripeClientService: StripeClientService,
  ) {}

  async createPaymentIntent(
    buyerId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<CreatePaymentIntentResult> {
    // 1. Authoritative order retrieval
    const order = await this.orderRepository.findOne({
      where: { id: dto.orderId },
    });

    if (!order) {
      throw new NotFoundException(`Order with id '${dto.orderId}' not found`);
    }

    // 2. Ownership verification
    if (order.buyerId !== buyerId) {
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

    // 4. Authoritative amount & currency validation
    let stripeAmount: number;
    try {
      stripeAmount = toStripeAmount(order.total, order.currency);
    } catch (amountError) {
      throw new BadRequestException((amountError as Error).message);
    }
    const stripeCurrency = order.currency.toLowerCase().trim();

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
        if (existingByKey.providerPaymentId) {
          const stripe = this.stripeClientService.getClient();
          const existingPi = await stripe.paymentIntents.retrieve(
            existingByKey.providerPaymentId,
          );
          if (existingPi.client_secret) {
            return {
              paymentId: existingByKey.id,
              orderId: order.id,
              paymentIntentId: existingPi.id,
              clientSecret: existingPi.client_secret,
              amount: order.total,
              currency: order.currency,
              status: existingByKey.status,
            };
          }
        }
      }
    }

    // 6. Check for an existing non-terminal payment attempt on this order
    const activePayment = await this.paymentRepository.findOne({
      where: {
        orderId: order.id,
        status: In(['INITIATED', 'PENDING']),
      },
      order: { createdAt: 'DESC' },
    });

    if (
      activePayment?.providerPaymentId &&
      activePayment.amount === order.total &&
      activePayment.currency === order.currency
    ) {
      try {
        const stripe = this.stripeClientService.getClient();
        const existingPi = await stripe.paymentIntents.retrieve(
          activePayment.providerPaymentId,
        );
        if (
          existingPi.status !== 'canceled' &&
          existingPi.status !== 'requires_capture' &&
          existingPi.client_secret
        ) {
          return {
            paymentId: activePayment.id,
            orderId: order.id,
            paymentIntentId: existingPi.id,
            clientSecret: existingPi.client_secret,
            amount: order.total,
            currency: order.currency,
            status: activePayment.status,
          };
        }
      } catch (retrieveError) {
        this.logger.warn(
          `Could not retrieve active PaymentIntent ${activePayment.providerPaymentId}: ${(retrieveError as Error).message}. Proceeding with new creation.`,
        );
      }
    }

    // 7. Calculate attempt number
    const previousAttempts = await this.paymentRepository.count({
      where: { orderId: order.id },
    });
    const attemptNo = previousAttempts + 1;

    // 8. Stripe PaymentIntent Creation with deterministic idempotency key
    const stripe = this.stripeClientService.getClient();
    const stripeIdempotencyKey =
      dto.idempotencyKey ?? `nexus_order_${order.id}_attempt_${attemptNo}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: stripeAmount,
        currency: stripeCurrency,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          buyerId: order.buyerId,
        },
      },
      {
        idempotencyKey: stripeIdempotencyKey,
      },
    );

    if (!paymentIntent.client_secret) {
      throw new InternalServerErrorException(
        'Stripe failed to return client_secret for PaymentIntent',
      );
    }

    // 9. Persist payment record with race-condition / unique-constraint recovery
    const payment = this.paymentRepository.create({
      orderId: order.id,
      checkoutSessionId: order.checkoutSessionId,
      provider: 'STRIPE',
      providerPaymentId: paymentIntent.id,
      amount: order.total,
      currency: order.currency,
      status: 'INITIATED',
      attemptNo,
      idempotencyKey: dto.idempotencyKey ?? null,
    });

    try {
      await this.paymentRepository.save(payment);
    } catch (dbError) {
      const pgCode = (dbError as { code?: string })?.code;
      // PostgreSQL 23505: unique_violation on provider_payment_id or idempotency_key
      if (pgCode === '23505') {
        this.logger.warn(
          `Unique constraint violation (23505) detected on payment persistence for order ${order.id}. Recovering existing record.`,
        );
        const recovered = await this.paymentRepository.findOne({
          where: [
            { providerPaymentId: paymentIntent.id },
            ...(dto.idempotencyKey
              ? [{ idempotencyKey: dto.idempotencyKey }]
              : []),
          ],
        });

        if (recovered) {
          if (recovered.orderId !== order.id) {
            throw new ConflictException(
              'Idempotency key has already been used for a different order',
            );
          }
          return {
            paymentId: recovered.id,
            orderId: order.id,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            amount: order.total,
            currency: order.currency,
            status: recovered.status,
          };
        }
      }

      this.logger.error(
        `PaymentIntent ${paymentIntent.id} created, but database save failed for order ${order.id}: ${(dbError as Error).message}`,
        (dbError as Error).stack,
      );
      throw dbError;
    }

    return {
      paymentId: payment.id,
      orderId: order.id,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: order.total,
      currency: order.currency,
      status: payment.status,
    };
  }
}
