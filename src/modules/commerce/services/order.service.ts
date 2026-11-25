import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CatalogCartApi } from '../../catalog/catalog-cart.api.js';
import { UserAddressEntity } from '../../identity/users/entities/user-address.entity.js';
import { InventoryReservationApi } from '../../fulfillment/inventory-reservation.api.js';
import { InventoryReadApi } from '../../fulfillment/inventory-read.api.js';
import { CartEntity } from '../domain/entities/cart.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { CheckoutSessionEntity } from '../domain/entities/checkout-session.entity.js';
import { OrderEntity } from '../domain/entities/order.entity.js';
import { OrderItemEntity } from '../domain/entities/order-item.entity.js';
import { OrderDisputeEntity } from '../domain/entities/order-dispute.entity.js';
import { OrderStatusHistoryEntity } from '../domain/entities/order-status-history.entity.js';
import { PaymentEntity } from '../domain/entities/payment.entity.js';
import { PayosClientService } from './payos-client.service.js';
import { CreateCheckoutDto } from '../dtos/create-checkout.dto.js';
import { QueryOrdersDto } from '../dtos/query-orders.dto.js';
import { QuerySellerOrdersDto } from '../dtos/query-seller-orders.dto.js';
import { ConfirmSellerOrderDto } from '../dtos/confirm-seller-order.dto.js';
import { ShipSellerOrderDto } from '../dtos/ship-seller-order.dto.js';
import { orderInventoryReceipts } from './order-inventory-receipts.js';
import { OrderExpiryOutboxApi } from '../order-expiry-outbox.api.js';
import { CoinService } from '../../coin/coin.service.js';
import { coinDiscountCents, coinLimit } from '../../coin/coin-policy.js';
import { centsToMoney, moneyToCents } from './cart-money.js';
import { OrderStateMachineService } from './order-state-machine.service.js';
import { GhnClientService } from '../../fulfillment/services/ghn-client.service.js';
import { ShippingQuoteService } from '../../fulfillment/services/shipping-quote.service.js';
import { IdentitySupportLookupApi } from '../../identity/identity-support-lookup.api.js';
import type { CartSku } from '../../catalog/catalog-cart.api.js';
import { NotificationDispatchApi } from '../../notification/notification-dispatch.api.js';
import { FlashDealQuotaService } from './flash-deal-quota.service.js';
import {
  loadBuyerOrderDispute,
  resolveOrderReferenceField,
} from './order-dispute-lookup.helper.js';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CartEntity)
    private readonly cartRepo: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemRepo: Repository<CartItemEntity>,
    @InjectRepository(CheckoutSessionEntity)
    private readonly checkoutSessionRepo: Repository<CheckoutSessionEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepo: Repository<OrderItemEntity>,
    @InjectRepository(OrderStatusHistoryEntity)
    private readonly orderHistoryRepo: Repository<OrderStatusHistoryEntity>,
    @InjectRepository(UserAddressEntity)
    private readonly addressRepo: Repository<UserAddressEntity>,
    private readonly catalogApi: CatalogCartApi,
    private readonly flashDeals: FlashDealQuotaService,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly inventoryReservation: InventoryReservationApi,
    private readonly expiryOutbox: OrderExpiryOutboxApi,
    @Optional()
    private readonly payosClientService?: PayosClientService,
    @Optional()
    private readonly ghnClientService?: GhnClientService,
    @Optional()
    private readonly shippingQuotes?: ShippingQuoteService,
    @Optional()
    private readonly inventoryRead?: InventoryReadApi,
    @Optional()
    private readonly identityLookup?: IdentitySupportLookupApi,
    @Optional()
    private readonly notifications?: NotificationDispatchApi,
  ) {}

  async quoteCart(userId: string, dto: CreateCheckoutDto) {
    if (
      !dto.addressId ||
      !dto.selectedCartItemIds?.length ||
      new Set(dto.selectedCartItemIds).size !== dto.selectedCartItemIds.length
    ) {
      throw new BadRequestException(
        'A saved address and unique selected cart items are required',
      );
    }
    const cart = await this.cartRepo.findOne({
      where: { userId: userId.toLowerCase(), status: 'ACTIVE' },
    });
    if (!cart) throw new BadRequestException('Cart is unavailable');
    const items = (
      await this.cartItemRepo.find({ where: { cartId: cart.id } })
    ).filter((item) => dto.selectedCartItemIds!.includes(item.id));
    if (items.length !== dto.selectedCartItemIds.length)
      throw new BadRequestException('Selected cart items are unavailable');
    const now = new Date();
    if (
      items.some(
        (item) =>
          item.reservedOrderId &&
          (!item.reservationExpiresAt || item.reservationExpiresAt > now),
      )
    )
      throw new ConflictException('A selected cart item is reserved');
    if (!this.inventoryRead)
      throw new ServiceUnavailableException(
        'Inventory availability is unavailable',
      );
    const requested = new Map<string, number>();
    for (const item of items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0)
        throw new BadRequestException('Invalid cart quantity');
      const skuId = item.skuId.toLowerCase();
      const quantity = (requested.get(skuId) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity))
        throw new BadRequestException('Invalid cart quantity');
      requested.set(skuId, quantity);
    }
    const stock = await this.inventoryRead.getDefaultWarehouseStock([
      ...requested.keys(),
    ]);
    const available = new Map(
      stock.map((row) => [row.skuId.toLowerCase(), row.availableQuantity]),
    );
    for (const [skuId, quantity] of requested) {
      const count = available.get(skuId);
      if (!Number.isSafeInteger(count) || count! < quantity)
        throw new ConflictException('Insufficient available inventory');
    }
    const address = await this.addressRepo.findOne({
      where: { id: dto.addressId, userId: userId.toLowerCase() },
    });
    if (!address) throw new NotFoundException('Address not found');
    if (
      address.addressScheme !== 'ghn_v3' ||
      !address.provinceName ||
      !address.wardName
    )
      throw new BadRequestException(
        'An upgraded GHN two-level saved address is required',
      );
    if (!this.shippingQuotes)
      throw new ServiceUnavailableException('Shipping quotes are unavailable');
    const skus = new Map(
      (await this.catalogApi.getCartSkus(items.map((item) => item.skuId))).map(
        (sku) => [sku.id, sku],
      ),
    );
    const groups = new Map<string, CartItemEntity[]>();
    for (const item of items) {
      const sku = skus.get(item.skuId);
      if (
        !sku ||
        !sku.isActive ||
        sku.productStatus !== 'ACTIVE' ||
        sku.productDeletedAt
      )
        throw new BadRequestException('Selected product is unavailable');
      this.assertNotOwnProduct(userId, sku);
      const group = groups.get(sku.sellerId) ?? [];
      group.push(item);
      groups.set(sku.sellerId, group);
    }
    const sellers = await this.quoteSellerGroups(groups, skus, address);
    return {
      currency: 'VND',
      totalFee: sellers.reduce((sum, seller) => sum + seller.fee, 0),
      sellers,
    };
  }

  private async quoteSellerGroups(
    groups: Map<string, CartItemEntity[]>,
    skus: Map<string, CartSku>,
    address: {
      recipientName: string;
      recipientPhone: string;
      addressLine: string;
      provinceName: string | null;
      wardName: string | null;
    },
  ) {
    if (!this.shippingQuotes)
      throw new ServiceUnavailableException('Shipping quotes are unavailable');
    if (!address.provinceName || !address.wardName)
      throw new BadRequestException(
        'An upgraded GHN two-level saved address is required',
      );
    const sellers: Array<{
      sellerId: string;
      weightGrams: number;
      fee: number;
    }> = [];
    for (const [sellerId, items] of groups) {
      let weightGrams = 0;
      const names: string[] = [];
      for (const item of items) {
        const weight = skus.get(item.skuId)?.weightGrams;
        const name = skus.get(item.skuId)?.productName?.trim();
        if (
          !Number.isSafeInteger(weight) ||
          weight! <= 0 ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0
        ) {
          throw new BadRequestException({
            errorCode: 'SHIPPING_WEIGHT_MISSING',
            message:
              'Every selected SKU must have a positive persisted weight and quantity',
          });
        }
        if (!name)
          throw new BadRequestException(
            'Product name is required for shipping',
          );
        names.push(name);
        weightGrams += weight! * item.quantity;
      }
      const quote = await this.shippingQuotes.quoteNewAddress({
        recipientName: address.recipientName,
        recipientPhone: address.recipientPhone,
        addressLine: address.addressLine,
        provinceName: address.provinceName,
        wardName: address.wardName,
        weightGrams,
        content: names.join(', '),
      });
      sellers.push({ sellerId, weightGrams, fee: quote.fee });
    }
    return sellers;
  }

  /**
   * Tạo phiên checkout và các đơn hàng tách theo từng Người bán (Seller)
   * Giữ tồn kho tạm thời 15 phút (Soft-Hold)
   */
  async checkout(userId: string, dto: CreateCheckoutDto) {
    const requestedCoins = dto.useCoins ?? 0;
    if (requestedCoins > 0 && dto.paymentMethod === 'COD') {
      throw new BadRequestException('Coin redemption requires PayOS');
    }
    // 1. Kiểm tra giỏ hàng ACTIVE của người dùng
    const cart = await this.cartRepo.findOne({
      where: { userId: userId.toLowerCase(), status: 'ACTIVE' },
    });
    if (!cart) {
      throw new BadRequestException(
        'Bạn chưa có giỏ hàng khả dụng để đặt hàng',
      );
    }

    // 2. Lấy danh sách các mặt hàng trong giỏ
    let cartItems = await this.cartItemRepo.find({
      where: { cartId: cart.id },
      order: { createdAt: 'ASC' },
    });

    if (dto.selectedCartItemIds && dto.selectedCartItemIds.length > 0) {
      const selectedSet = new Set(dto.selectedCartItemIds);
      cartItems = cartItems.filter((item) => selectedSet.has(item.id));
    }

    if (cartItems.length === 0) {
      throw new BadRequestException(
        'Giỏ hàng trống hoặc không có sản phẩm nào được chọn',
      );
    }

    // 3. Lấy thông tin SKU & Sản phẩm mới nhất từ Catalog
    const skuIds = cartItems.map((item) => item.skuId);
    const catalogSkus = await this.catalogApi.getCartSkus(skuIds);
    let skuMap = new Map(catalogSkus.map((s) => [s.id, s]));

    // Kiểm tra tính khả dụng của từng mặt hàng
    for (const item of cartItems) {
      const sku = skuMap.get(item.skuId);
      if (
        !sku ||
        !sku.isActive ||
        sku.productStatus !== 'ACTIVE' ||
        sku.productDeletedAt
      ) {
        throw new BadRequestException(
          `Sản phẩm "${sku?.productName || item.productNameSnapshot || 'Không xác định'}" hiện không còn mở bán`,
        );
      }
      this.assertNotOwnProduct(userId, sku);
    }

    // 4. Xác định địa chỉ giao hàng
    let shippingSnapshot: Record<string, unknown>;
    let shippingAddressId: string | undefined;

    if (dto.shippingAddress) {
      shippingSnapshot = {
        recipientName: dto.shippingAddress.recipientName,
        recipientPhone: dto.shippingAddress.recipientPhone,
        addressLine: dto.shippingAddress.addressLine,
        provinceCode: dto.shippingAddress.provinceCode || null,
        districtCode: dto.shippingAddress.districtCode || null,
        wardCode: dto.shippingAddress.wardCode || null,
      };
    } else if (dto.addressId) {
      const address = await this.addressRepo.findOne({
        where: { id: dto.addressId, userId: userId.toLowerCase() },
      });
      if (!address) {
        throw new NotFoundException(
          'Không tìm thấy địa chỉ giao hàng được chọn',
        );
      }
      shippingAddressId = address.id;
      shippingSnapshot = {
        addressScheme: address.addressScheme,
        provinceName: address.provinceName,
        wardName: address.wardName,
        recipientName: address.recipientName,
        recipientPhone: address.recipientPhone,
        addressLine: address.addressLine,
        provinceCode: address.provinceCode,
        districtCode: address.districtCode,
        wardCode: address.wardCode,
      };
    } else {
      // Tìm địa chỉ mặc định của user
      const defaultAddress = await this.addressRepo.findOne({
        where: { userId: userId.toLowerCase(), isDefault: true },
      });
      const fallbackAddress =
        defaultAddress ||
        (await this.addressRepo.findOne({
          where: { userId: userId.toLowerCase() },
          order: { createdAt: 'DESC' },
        }));

      if (!fallbackAddress) {
        throw new BadRequestException(
          'Vui lòng cung cấp hoặc chọn một địa chỉ nhận hàng',
        );
      }
      shippingAddressId = fallbackAddress.id;

      shippingSnapshot = {
        addressScheme: fallbackAddress.addressScheme,
        provinceName: fallbackAddress.provinceName,
        wardName: fallbackAddress.wardName,
        recipientName: fallbackAddress.recipientName,
        recipientPhone: fallbackAddress.recipientPhone,
        addressLine: fallbackAddress.addressLine,
        provinceCode: fallbackAddress.provinceCode,
        districtCode: fallbackAddress.districtCode,
        wardCode: fallbackAddress.wardCode,
      };
    }

    // 5. Gom nhóm các món hàng theo từng Người bán (Seller)
    let itemsBySeller = new Map<string, typeof cartItems>();
    for (const item of cartItems) {
      const sku = skuMap.get(item.skuId)!;
      const sellerId = sku.sellerId;
      if (!itemsBySeller.has(sellerId)) {
        itemsBySeller.set(sellerId, []);
      }
      itemsBySeller.get(sellerId)!.push(item);
    }

    if (!this.shippingQuotes)
      throw new ServiceUnavailableException('Shipping quotes are unavailable');
    if (
      shippingSnapshot.addressScheme !== 'ghn_v3' ||
      typeof shippingSnapshot.provinceName !== 'string' ||
      typeof shippingSnapshot.wardName !== 'string'
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_SHIPPING_INPUT',
        message:
          'An upgraded GHN two-level saved address is required for checkout',
      });
    }
    const quotedFingerprint = this.shippingFingerprint(cartItems, skuMap);
    const sellerQuotes = await this.quoteSellerGroups(itemsBySeller, skuMap, {
      recipientName: shippingSnapshot.recipientName as string,
      recipientPhone: shippingSnapshot.recipientPhone as string,
      addressLine: shippingSnapshot.addressLine as string,
      provinceName: shippingSnapshot.provinceName,
      wardName: shippingSnapshot.wardName,
    });
    const shippingFees = new Map(
      sellerQuotes.map(({ sellerId, fee }) => [
        sellerId,
        moneyToCents(String(fee)),
      ]),
    );

    // 6. Tính toán thời gian hết hạn giữ kho (15 phút)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    // 7. Thực thi Transaction tạo CheckoutSession, Orders và OrderItems
    const result = await this.dataSource.transaction(async (manager) => {
      if (shippingAddressId) {
        const currentAddress = await manager
          .getRepository(UserAddressEntity)
          .findOne({
            where: { id: shippingAddressId, userId: userId.toLowerCase() },
            lock: { mode: 'pessimistic_write' },
          });
        if (
          !currentAddress ||
          (
            [
              'addressScheme',
              'recipientName',
              'recipientPhone',
              'addressLine',
              'provinceCode',
              'districtCode',
              'wardCode',
              'provinceName',
              'wardName',
            ] as const
          ).some((key) => currentAddress[key] !== shippingSnapshot[key])
        ) {
          throw new ConflictException({
            errorCode: 'SHIPPING_QUOTE_STALE',
            message: 'Shipping address changed; retry checkout',
          });
        }
      }
      const lockedCart = await manager.getRepository(CartEntity).findOne({
        where: { id: cart.id, userId: userId.toLowerCase(), status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedCart)
        throw new ConflictException('Cart is no longer active; retry checkout');
      const itemQuery = manager
        .getRepository(CartItemEntity)
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.cartId = :cartId', { cartId: cart.id })
        .orderBy('item.createdAt', 'ASC')
        .addOrderBy('item.id', 'ASC');
      if (dto.selectedCartItemIds?.length) {
        itemQuery.andWhere('item.id IN (:...selectedIds)', {
          selectedIds: dto.selectedCartItemIds,
        });
      }
      cartItems = await itemQuery.getMany();
      if (
        cartItems.length === 0 ||
        (dto.selectedCartItemIds?.length &&
          cartItems.length !== new Set(dto.selectedCartItemIds).size)
      ) {
        throw new BadRequestException(
          'Giỏ hàng trống hoặc không có sản phẩm nào được chọn',
        );
      }
      for (const item of cartItems) {
        if (
          item.reservedOrderId &&
          item.reservationExpiresAt &&
          item.reservationExpiresAt <= now
        ) {
          item.reservedOrderId = null;
          item.reservationExpiresAt = null;
          await manager.update(
            CartItemEntity,
            { id: item.id },
            { reservedOrderId: null, reservationExpiresAt: null },
          );
        }
      }
      if (cartItems.some((item) => Boolean(item.reservedOrderId))) {
        throw new ConflictException({
          errorCode: 'CART_ITEM_RESERVED',
          message: 'A selected cart item is reserved by an active checkout',
        });
      }
      const lockedSkus = await this.catalogApi.getCartSkus(
        cartItems.map((item) => item.skuId),
        manager,
      );
      skuMap = new Map(lockedSkus.map((sku) => [sku.id, sku]));
      const resolvedFlashDeals = await this.flashDeals.resolveForCheckout(
        manager,
        cartItems,
        lockedSkus,
        dto.expectedFlashDeals,
      );
      if (this.shippingFingerprint(cartItems, skuMap) !== quotedFingerprint) {
        throw new ConflictException({
          errorCode: 'SHIPPING_QUOTE_STALE',
          message:
            'Selected cart contents changed while quoting shipping; retry checkout',
        });
      }
      itemsBySeller = new Map();
      for (const item of cartItems) {
        const sku = skuMap.get(item.skuId);
        if (
          !sku ||
          !sku.isActive ||
          sku.productStatus !== 'ACTIVE' ||
          sku.productDeletedAt
        ) {
          throw new BadRequestException(
            `Sản phẩm "${sku?.productName || item.productNameSnapshot || 'Không xác định'}" hiện không còn mở bán`,
          );
        }
        this.assertNotOwnProduct(userId, sku);
        const sellerItems = itemsBySeller.get(sku.sellerId) ?? [];
        sellerItems.push(item);
        itemsBySeller.set(sku.sellerId, sellerItems);
      }

      const receipts = await this.inventoryReservation.reserve(
        cartItems.map((item) => ({
          skuId: item.skuId,
          quantity: item.quantity,
        })),
        manager,
      );
      const warehouseBySku = new Map(
        receipts.map((receipt) => [
          receipt.skuId.toLowerCase(),
          receipt.warehouseId,
        ]),
      );

      let sessionSubtotalCents = 0n;
      let sessionShippingFeeCents = 0n;

      // Danh sách order tạm tính
      const ordersToCreate: Array<{
        sellerId: string;
        orderCode: string;
        subtotalCents: bigint;
        shippingFeeCents: bigint;
        totalCents: bigint;
        items: Array<{
          cartItemId: string;
          skuId: string;
          productId: string;
          productName: string;
          attributes: Record<string, unknown> | null;
          imageUrl: string | null;
          unitPrice: string;
          quantity: number;
          weightGrams: number;
          lineTotalCents: bigint;
          flashDealItemId?: string;
        }>;
      }> = [];

      for (const [sellerId, sellerItems] of itemsBySeller.entries()) {
        let sellerSubtotalCents = 0n;
        const sellerItemsData = [];

        for (const item of sellerItems) {
          const sku = skuMap.get(item.skuId)!;
          const flashDeal = resolvedFlashDeals.get(item.id);
          const unitPrice = flashDeal?.unitPrice ?? sku.price;
          const unitPriceCents = moneyToCents(unitPrice);
          const lineTotalCents = unitPriceCents * BigInt(item.quantity);

          sellerSubtotalCents += lineTotalCents;
          sellerItemsData.push({
            cartItemId: item.id,
            skuId: sku.id,
            productId: sku.productId,
            productName: sku.productName,
            attributes: sku.variantAttributes,
            imageUrl: sku.primaryImageUrl || null,
            unitPrice,
            quantity: item.quantity,
            weightGrams: sku.weightGrams!,
            lineTotalCents,
            flashDealItemId: flashDeal?.itemId,
          });
        }

        const shippingFeeCents = shippingFees.get(sellerId)!;
        const orderTotalCents = sellerSubtotalCents + shippingFeeCents;

        sessionSubtotalCents += sellerSubtotalCents;
        sessionShippingFeeCents += shippingFeeCents;

        const orderCode = `ORD-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        ordersToCreate.push({
          sellerId,
          orderCode,
          subtotalCents: sellerSubtotalCents,
          shippingFeeCents,
          totalCents: orderTotalCents,
          items: sellerItemsData,
        });
      }

      const sessionTotalCents = sessionSubtotalCents + sessionShippingFeeCents;
      let remainingCoins = requestedCoins;
      const coinAllocation = ordersToCreate.map(
        ({ subtotalCents, totalCents }) => {
          const coins = Math.min(
            remainingCoins,
            coinLimit(subtotalCents, totalCents),
          );
          remainingCoins -= coins;
          return coins;
        },
      );
      if (remainingCoins > 0) {
        throw new BadRequestException({
          errorCode: 'COIN_DISCOUNT_LIMIT_EXCEEDED',
          message: 'The requested Coin discount exceeds the checkout limit',
        });
      }
      const sessionCoinDiscount = coinDiscountCents(requestedCoins);

      // Tạo Checkout Session
      const checkoutSession = manager.create(CheckoutSessionEntity, {
        sessionType: 'CART',
        cartId: cart.id,
        buyerId: userId.toLowerCase(),
        status: 'INITIATED',
        shippingAddress: shippingSnapshot,
        paymentMethod: dto.paymentMethod || 'PAYOS',
        subtotal: centsToMoney(sessionSubtotalCents),
        shippingFee: centsToMoney(sessionShippingFeeCents),
        discountAmount: centsToMoney(sessionCoinDiscount),
        tax: '0.00',
        total: centsToMoney(sessionTotalCents - sessionCoinDiscount),
        currency: 'VND',
        expiresAt,
        idempotencyKey: dto.idempotencyKey || null,
      });
      const savedSession = await manager.save(checkoutSession);

      // Tạo các Orders và OrderItems theo từng Seller
      const createdOrders: OrderEntity[] = [];
      const isCod = (dto.paymentMethod ?? 'PAYOS') === 'COD';
      const initialStatus = isCod ? 'PROCESSING' : 'PENDING_PAYMENT';
      const orderHoldExpiresAt = isCod ? null : expiresAt;

      for (const [index, orderData] of ordersToCreate.entries()) {
        const coins = coinAllocation[index];
        const coinDiscount = coinDiscountCents(coins);
        const order = manager.create(OrderEntity, {
          orderNumber: orderData.orderCode,
          checkoutSessionId: savedSession.id,
          buyerId: userId.toLowerCase(),
          sellerId: orderData.sellerId,
          source: 'CART',
          status: initialStatus,
          subtotal: centsToMoney(orderData.subtotalCents),
          shippingFee: centsToMoney(orderData.shippingFeeCents),
          discountAmount: centsToMoney(coinDiscount),
          tax: '0.00',
          total: centsToMoney(orderData.totalCents - coinDiscount),
          currency: 'VND',
          shippingAddressSnapshot: shippingSnapshot,
          holdExpiresAt: orderHoldExpiresAt,
          idempotencyKey: dto.idempotencyKey
            ? `${dto.idempotencyKey}-${orderData.sellerId}`
            : null,
        });
        const savedOrder = await manager.save(order);
        if (coins > 0) {
          await CoinService.redeem(
            manager,
            savedOrder.buyerId,
            savedOrder.id,
            coins,
          );
        }
        if (!isCod) {
          await this.expiryOutbox.schedule(savedOrder.id, expiresAt, manager);
        }

        const initialHistory = manager.create(OrderStatusHistoryEntity, {
          orderId: savedOrder.id,
          fromStatus: null,
          toStatus: initialStatus,
          reason: isCod ? 'ORDER_CREATED_COD' : 'ORDER_CREATED',
          changedBy: userId.toLowerCase(),
        });
        await manager.save(initialHistory);

        // Tạo OrderItems
        const orderItems = orderData.items.map((itemData) => {
          const warehouseId = warehouseBySku.get(itemData.skuId.toLowerCase());
          if (!warehouseId) {
            throw new BadRequestException({
              errorCode: 'INVALID_INVENTORY_RECEIPT',
              message:
                'Inventory reservation did not return every requested SKU',
            });
          }
          const orderItem = manager.create(OrderItemEntity, {
            orderId: savedOrder.id,
            productId: itemData.productId,
            skuId: itemData.skuId,
            warehouseId,
            productNameSnapshot: itemData.productName,
            skuAttributesSnapshot: itemData.attributes,
            unitPrice: itemData.unitPrice,
            quantity: itemData.quantity,
            weightGramsSnapshot: itemData.weightGrams,
            discountAmount: '0.00',
            lineTotal: centsToMoney(itemData.lineTotalCents),
          });
          orderItem.imageUrl = itemData.imageUrl;
          orderItem.primaryImageUrl = itemData.imageUrl;
          return orderItem;
        });
        await manager.save(orderItems);
        const sellerCartItemIds = orderData.items.map(
          (item) => item.cartItemId,
        );
        if (isCod) {
          await manager.delete(CartItemEntity, {
            id: In(sellerCartItemIds),
          });
        } else {
          await manager.update(
            CartItemEntity,
            { id: In(sellerCartItemIds) },
            {
              reservedOrderId: savedOrder.id,
              reservationExpiresAt: expiresAt,
            },
          );
        }
        savedOrder.items = orderItems;
        createdOrders.push(savedOrder);
      }

      const flashDealOrders = ordersToCreate
        .map((orderData, index) => ({
          orderId: createdOrders[index].id,
          items: orderData.items
            .filter((item) => item.flashDealItemId)
            .map((item) => ({
              itemId: item.flashDealItemId!,
              skuId: item.skuId,
              quantity: item.quantity,
            })),
        }))
        .filter((order) => order.items.length > 0);
      if (flashDealOrders.length > 0) {
        await this.flashDeals.reserve(manager, {
          buyerId: userId.toLowerCase(),
          orders: flashDealOrders,
        });
      }

      return {
        checkoutSessionId: savedSession.id,
        status: savedSession.status,
        expiresAt: savedSession.expiresAt,
        paymentMethod: savedSession.paymentMethod,
        totalAmount: savedSession.total,
        coinDiscountAmount: savedSession.discountAmount,
        payableAmount: savedSession.total,
        currency: savedSession.currency,
        orders: createdOrders.map((o) => ({
          id: o.id,
          orderCode: o.orderNumber,
          orderNumber: o.orderNumber,
          sellerId: o.sellerId,
          status: o.status,
          total: o.total,
          totalAmount: o.total,
          coinDiscountAmount: o.discountAmount,
          payableAmount: o.total,
          paymentMethod: savedSession.paymentMethod,
          itemsCount:
            o.items?.reduce(
              (sum, item) => sum + (Number(item.quantity) || 0),
              0,
            ) || 0,
          holdExpiresAt: o.holdExpiresAt,
          paymentDeadlineAt: o.holdExpiresAt, // Alias tương thích cho FE
        })),
      };
    });

    void this.expiryOutbox.reconcile().catch(() => {
      // The committed outbox intent is durable; lifecycle reconciliation retries it.
    });
    return result;
  }

  /**
   * Lấy danh sách đơn hàng của người mua (phân trang chuẩn Envelope)
   */
  async getBuyerOrders(userId: string, query: QueryOrdersDto) {
    const buyerId = userId.toLowerCase();
    await this.reconcileExpiredPayosOrders({ buyerId });

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.checkoutSession', 'checkoutSession')
      .where('order.buyerId = :userId', { userId: buyerId });

    if (query.status) {
      qb.andWhere('order.status = :status', { status: query.status });
    }

    qb.orderBy('order.createdAt', 'DESC').skip(skip).take(limit);

    const [orders, totalItems] = await qb.getManyAndCount();
    await Promise.all([
      this.enrichOrdersWithImages(orders),
      this.attachShopInfo(orders),
    ]);
    for (const order of orders) {
      if (order.checkoutSession) {
        order.paymentMethod = order.checkoutSession.paymentMethod;
      }
    }
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    return {
      data: orders,
      meta: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Lấy danh sách đơn hàng thuộc đúng tài khoản người bán đang đăng nhập.
   */
  async getSellerOrders(sellerId: string, query: QuerySellerOrdersDto) {
    const normalizedSellerId = sellerId.toLowerCase();
    await this.reconcileExpiredPayosOrders({
      sellerId: normalizedSellerId,
    });
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.checkoutSession', 'checkoutSession')
      .where('order.sellerId = :sellerId', {
        sellerId: normalizedSellerId,
      })
      .andWhere('order.status != :unpaidStatus', {
        unpaidStatus: 'PENDING_PAYMENT',
      });

    if (query.status) {
      qb.andWhere('order.status = :status', { status: query.status });
    }

    qb.orderBy('order.createdAt', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [orders, total] = await qb.getManyAndCount();
    await this.enrichOrdersWithImages(orders);

    return {
      data: orders.map((order) => this.toSellerOrderSummary(order)),
      meta: {
        page,
        limit,
        total,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Xem chi tiết đơn hàng của người bán. Ownership nằm ngay trong truy vấn để
   * không làm lộ sự tồn tại của đơn hàng thuộc shop khác.
   */
  async getSellerOrderById(sellerId: string, orderReference: string) {
    const normalizedSellerId = sellerId.toLowerCase();
    await this.reconcileExpiredPayosOrders(
      { sellerId: normalizedSellerId },
      orderReference,
    );
    const order = await this.orderRepo.findOne({
      where: {
        [this.orderReferenceField(orderReference)]: orderReference,
        sellerId: normalizedSellerId,
      },
      relations: { items: true, checkoutSession: true },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng yêu cầu');
    }

    await this.enrichOrdersWithImages([order]);
    const history = await this.orderHistoryRepo.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return {
      id: order.id,
      orderCode: order.orderNumber,
      status: order.status,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      tax: order.tax,
      totalAmount: order.total,
      currency: order.currency,
      paymentMethod: order.checkoutSession?.paymentMethod ?? null,
      shippingAddress: order.shippingAddressSnapshot,
      trackingCode: order.trackingCode ?? null,
      carrierName: order.carrierName ?? null,
      items: (order.items ?? []).map((item) => ({
        id: item.id,
        productId: item.productId,
        skuId: item.skuId,
        productNameSnapshot: item.productNameSnapshot,
        skuAttributesSnapshot: item.skuAttributesSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discountAmount: item.discountAmount,
        lineTotal: item.lineTotal,
        imageUrl: item.imageUrl ?? null,
      })),
      history: history.map((entry) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private assertNotOwnProduct(userId: string, sku: { sellerId: string }): void {
    if (sku.sellerId.toLowerCase() === userId.toLowerCase()) {
      throw new ForbiddenException({
        errorCode: 'CANNOT_BUY_OWN_PRODUCT',
        message: 'Sellers cannot buy their own products',
      });
    }
  }

  /**
   * Xem chi tiết một đơn hàng theo ID
   */
  async getOrderById(userId: string, orderReference: string) {
    const buyerId = userId.toLowerCase();
    await this.reconcileExpiredPayosOrders({ buyerId }, orderReference);

    const order = await this.orderRepo.findOne({
      where: {
        [this.orderReferenceField(orderReference)]: orderReference,
        buyerId,
      },
      relations: {
        items: true,
        checkoutSession: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng yêu cầu');
    }

    await Promise.all([
      this.enrichOrdersWithImages([order]),
      this.attachShopInfo([order]),
      this.attachReviewIds(order),
    ]);
    if (order.checkoutSession) {
      order.paymentMethod = order.checkoutSession.paymentMethod;
    }

    const history = await this.orderHistoryRepo.find({
      where: { orderId: order.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const dispute =
      typeof this.dataSource?.getRepository === 'function'
        ? await this.dataSource.getRepository(OrderDisputeEntity).findOne({
            where: { orderId: order.id },
          })
        : null;

    return {
      ...order,
      history,
      dispute: dispute
        ? {
            id: dispute.id,
            status: dispute.status,
            reasonCategory: dispute.reasonCategory,
            evidenceDescription: dispute.evidenceDescription,
            evidenceImages: dispute.evidenceImages,
            staffDecisionNote: dispute.staffDecisionNote,
            resolvedAt: dispute.resolvedAt,
            createdAt: dispute.createdAt,
          }
        : null,
    };
  }

  private async attachReviewIds(order: OrderEntity): Promise<void> {
    const items = order.items ?? [];
    if (items.length === 0 || typeof this.dataSource?.query !== 'function')
      return;
    const rows = await this.dataSource.query<
      Array<{ orderItemId: string; reviewId: string }>
    >(
      `SELECT order_item_id AS "orderItemId", id AS "reviewId"
         FROM catalog.product_reviews WHERE order_item_id = ANY($1::uuid[])`,
      [items.map((item) => item.id)],
    );
    const byItem = new Map(rows.map((row) => [row.orderItemId, row.reviewId]));
    for (const item of items) item.reviewId = byItem.get(item.id) ?? null;
  }

  private async reconcileExpiredPayosOrders(
    owner: { buyerId: string } | { sellerId: string },
    orderReference?: string,
  ): Promise<void> {
    const candidatesQuery = this.orderRepo
      .createQueryBuilder('order')
      .innerJoin('order.checkoutSession', 'checkoutSession')
      .select('order.id', 'orderId');

    if ('buyerId' in owner) {
      candidatesQuery.where('order.buyerId = :buyerId', {
        buyerId: owner.buyerId,
      });
    } else {
      candidatesQuery.where('order.sellerId = :sellerId', {
        sellerId: owner.sellerId,
      });
    }

    candidatesQuery
      .andWhere('order.status = :pendingStatus', {
        pendingStatus: 'PENDING_PAYMENT',
      })
      .andWhere('order.holdExpiresAt IS NOT NULL')
      .andWhere('order.holdExpiresAt <= clock_timestamp()')
      .andWhere('checkoutSession.paymentMethod = :paymentMethod', {
        paymentMethod: 'PAYOS',
      });

    if (orderReference) {
      const field = this.orderReferenceField(orderReference);
      candidatesQuery.andWhere(`order.${field} = :orderReference`, {
        orderReference,
      });
    }

    const candidates = await candidatesQuery.getRawMany<{ orderId: string }>();
    for (const candidate of candidates) {
      await this.dataSource.transaction('READ COMMITTED', async (manager) => {
        const transition = await this.orderStateMachine.expire(
          candidate.orderId,
          manager,
        );
        if (transition.outcome !== 'EXPIRED') return;

        await this.inventoryReservation.release(
          transition.inventoryReceipts,
          manager,
        );
        await this.orderStateMachine.finalizeExpiry(candidate.orderId, manager);
      });
    }
  }

  private orderReferenceField(reference: string): 'id' | 'orderNumber' {
    return resolveOrderReferenceField(reference);
  }

  async cancelOrder(userId: string, orderId: string) {
    const buyerId = userId.toLowerCase();

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const chosen = await manager.getRepository(OrderEntity).findOne({
        where: { id: orderId, buyerId },
      });
      if (!chosen) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Order was not found',
        });
      }
      if (!chosen.checkoutSessionId) {
        throw new ConflictException({
          errorCode: 'ORDER_SESSION_NOT_CANCELLABLE',
          message: 'Order does not belong to a checkout session',
        });
      }
      const session = await manager
        .getRepository(CheckoutSessionEntity)
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :sessionId', {
          sessionId: chosen.checkoutSessionId,
        })
        .getOne();
      if (
        !session ||
        session.paymentMethod !== 'PAYOS' ||
        !['INITIATED', 'PROCESSING'].includes(session.status)
      ) {
        throw new ConflictException({
          errorCode: 'CHECKOUT_SESSION_NOT_CANCELLABLE',
          message: 'Only an active PayOS checkout session can be cancelled',
        });
      }
      const siblings = await manager
        .getRepository(OrderEntity)
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.checkoutSessionId = :sessionId', {
          sessionId: chosen.checkoutSessionId,
        })
        .orderBy('order.id', 'ASC')
        .getMany();
      const pending = siblings.filter(
        (order) => order.status === 'PENDING_PAYMENT',
      );
      if (pending.length === 0) {
        throw new ConflictException({
          errorCode: 'ORDER_TRANSITION_NOT_ALLOWED',
          message: 'Checkout session has no pending orders to cancel',
        });
      }
      await this.orderStateMachine.prelockFlashDealOrders(
        manager,
        pending.map((order) => order.id),
      );
      for (const order of pending) {
        await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'CANCELLED',
          actorId: buyerId,
          expectedBuyerId: buyerId,
          reason: 'CHECKOUT_CANCELLED_BY_BUYER',
        });
        const items = await manager.getRepository(OrderItemEntity).find({
          select: { skuId: true, quantity: true, warehouseId: true },
          where: { orderId: order.id },
          order: { id: 'ASC' },
        });
        await this.inventoryReservation.release(
          orderInventoryReceipts(items),
          manager,
        );
      }

      let pendingPayments: PaymentEntity[] = [];
      try {
        pendingPayments = await manager.getRepository(PaymentEntity).find({
          where: {
            orderId: In(pending.map((order) => order.id)),
            provider: 'PAYOS',
            status: In(['INITIATED', 'PENDING']),
          },
        });
      } catch {
        // Fallback if PaymentEntity repository is not mounted on manager in test mocks
      }
      await manager
        .getRepository(CartItemEntity)
        .update(
          { reservedOrderId: In(pending.map((order) => order.id)) },
          { reservedOrderId: null, reservationExpiresAt: null },
        );
      await manager
        .getRepository(CheckoutSessionEntity)
        .update({ id: chosen.checkoutSessionId }, { status: 'CANCELLED' });

      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: orderId, buyerId },
        relations: { items: true, checkoutSession: true },
      });
      if (order) {
        await this.enrichOrdersWithImages([order]);
      }
      const history = await manager
        .getRepository(OrderStatusHistoryEntity)
        .find({
          where: { orderId },
          order: { createdAt: 'ASC', id: 'ASC' },
        });

      const result = { ...order!, history };
      if (this.payosClientService && pendingPayments.length > 0) {
        for (const payment of pendingPayments) {
          if (payment.providerPaymentId) {
            try {
              await this.payosClientService.cancelPaymentLink(
                payment.providerPaymentId,
                'Khách hàng hủy đơn trên website',
              );
            } catch (err) {
              this.logger.warn(
                `Failed to cancel PayOS payment ${payment.providerPaymentId}: ${(err as Error).message}`,
              );
            }
          }
        }
      }
      return result;
    });
  }

  /**
   * Đính kèm ảnh sản phẩm cho các mặt hàng trong đơn hàng
   */
  private async enrichOrdersWithImages(orders: OrderEntity[]): Promise<void> {
    const productIds = Array.from(
      new Set(
        orders
          .flatMap((o) => o.items || [])
          .map((i) => i.productId)
          .filter(Boolean),
      ),
    );
    if (productIds.length === 0) return;

    if (typeof this.dataSource?.query === 'function') {
      const rows: Array<{ productId: string; url: string }> =
        await this.dataSource.query(
          `SELECT DISTINCT ON (product_id) product_id as "productId", url
           FROM catalog.product_images
           WHERE product_id = ANY($1)
           ORDER BY product_id, is_primary DESC, sort_order ASC, id ASC`,
          [productIds],
        );
      const imageMap = new Map(rows.map((r) => [r.productId, r.url]));

      for (const order of orders) {
        if (!order.items) continue;
        for (const item of order.items) {
          const url = imageMap.get(item.productId) || null;
          item.imageUrl = url;
          item.primaryImageUrl = url;
        }
      }
    }
  }

  /**
   * Đính kèm shopId và shopSlug của người bán vào đơn hàng cho Buyer (ví dụ nút Chat with shop)
   */
  private async attachShopInfo(orders: OrderEntity[]): Promise<void> {
    if (!this.identityLookup || orders.length === 0) return;

    const sellerIds = Array.from(
      new Set(orders.map((order) => order.sellerId).filter(Boolean)),
    );
    const shops =
      sellerIds.length > 0
        ? await this.identityLookup.getShopsBySellerIds(sellerIds)
        : [];
    const shopMap = new Map(
      shops.map((shop) => [shop.sellerId.toLowerCase(), shop]),
    );

    for (const order of orders) {
      const shop = order.sellerId
        ? shopMap.get(order.sellerId.toLowerCase())
        : undefined;
      const target = order as OrderEntity & {
        shopId?: string | null;
        shopSlug?: string | null;
      };
      target.shopId = shop?.id ?? null;
      target.shopSlug = shop?.slug ?? null;
    }
  }

  private toSellerOrderSummary(order: OrderEntity) {
    const shippingAddress = order.shippingAddressSnapshot ?? {};
    const items = order.items ?? [];

    return {
      id: order.id,
      orderCode: order.orderNumber,
      status: order.status,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      totalAmount: order.total,
      currency: order.currency,
      paymentMethod: order.checkoutSession?.paymentMethod ?? null,
      buyerName: this.snapshotString(shippingAddress, 'recipientName'),
      buyerPhone: this.snapshotString(shippingAddress, 'recipientPhone'),
      itemCount: items.reduce((total, item) => total + item.quantity, 0),
      itemsSummary: items.map((item) => ({
        productName: item.productNameSnapshot,
        skuAttributes: item.skuAttributesSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        imageUrl: item.imageUrl ?? null,
      })),
      createdAt: order.createdAt,
    };
  }

  private snapshotString(
    snapshot: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = snapshot[key];
    return typeof value === 'string' ? value : null;
  }

  private shippingFingerprint(
    items: CartItemEntity[],
    skus: Map<string, CartSku>,
  ): string {
    return JSON.stringify(
      items
        .map((item) => [
          item.id,
          item.skuId,
          item.quantity,
          skus.get(item.skuId)?.sellerId,
          skus.get(item.skuId)?.weightGrams,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  }

  /**
   * Người bán bấm Xác nhận đơn hàng (PAID -> PROCESSING)
   */
  async confirmSellerOrder(
    sellerId: string,
    orderId: string,
    dto?: ConfirmSellerOrderDto,
  ) {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const order = await manager.getRepository(OrderEntity).findOne({
        where: { id: orderId, sellerId },
      });
      if (!order) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message:
            'Không tìm thấy đơn hàng hoặc bạn không có quyền xử lý đơn này',
        });
      }
      if (order.status !== 'PAID') {
        throw new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message: `Chỉ có thể xác nhận đơn hàng đang ở trạng thái PAID (hiện tại: ${order.status})`,
        });
      }

      const confirmed = await this.orderStateMachine.transition(manager, {
        orderId: order.id,
        toStatus: 'PROCESSING',
        actorId: sellerId,
        reason: dto?.note ?? 'Người bán xác nhận đơn hàng',
      });

      return {
        orderId: order.id,
        status: 'PROCESSING' as const,
        updatedAt: confirmed.updatedAt,
      };
    });
  }

  /**
   * Người bán bàn giao đơn hàng cho đơn vị vận chuyển (PROCESSING -> SHIPPED)
   */
  async shipSellerOrder(
    sellerId: string,
    orderId: string,
    dto?: ShipSellerOrderDto,
  ) {
    const trackingCode =
      typeof dto?.trackingCode === 'string' ? dto.trackingCode.trim() : '';
    const carrierName =
      typeof dto?.carrierName === 'string' ? dto.carrierName.trim() : '';
    if (
      !trackingCode ||
      !carrierName ||
      trackingCode.length > 100 ||
      carrierName.length > 100
    ) {
      throw new BadRequestException({
        errorCode: 'ORDER_SHIPPING_INVALID',
        message:
          'Carrier name and tracking code are required and must be at most 100 characters',
      });
    }
    const result = await this.dataSource.transaction(
      'READ COMMITTED',
      async (manager) => {
        const order = await manager.getRepository(OrderEntity).findOne({
          where: { id: orderId, sellerId },
        });
        if (!order) {
          throw new NotFoundException({
            errorCode: 'ORDER_NOT_FOUND',
            message:
              'Không tìm thấy đơn hàng hoặc bạn không có quyền xử lý đơn này',
          });
        }
        if (order.status !== 'PROCESSING') {
          throw new ConflictException({
            errorCode: 'ORDER_STATUS_INVALID',
            message: `Chỉ có thể giao đơn hàng đang ở trạng thái PROCESSING (hiện tại: ${order.status})`,
          });
        }

        const reasonDetails = [
          `Đơn vị vận chuyển: ${carrierName}`,
          `Mã vận đơn: ${trackingCode}`,
          dto?.note ? `Ghi chú: ${dto.note}` : null,
        ]
          .filter(Boolean)
          .join(' | ');

        const shipped = await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'SHIPPED',
          actorId: sellerId,
          reason: reasonDetails,
        });

        await this.deductCodOrderStockOnShipment(
          manager,
          order,
          sellerId,
          `COD order shipped: ${carrierName} - ${trackingCode}`,
        );

        shipped.trackingCode = trackingCode;
        shipped.carrierName = carrierName;
        const saved = await manager.getRepository(OrderEntity).save(shipped);

        return {
          orderId: order.id,
          status: 'SHIPPED' as const,
          trackingCode: saved.trackingCode ?? order.trackingCode,
          carrierName: saved.carrierName,
          updatedAt: saved.updatedAt,
        };
      },
    );
    await this.notifyOrderStatus(orderId, 'ORDER_SHIPPED');
    return result;
  }

  /**
   * Người bán bàn giao đơn hàng tự động cho Giao Hàng Nhanh (GHN Sandbox)
   */
  async shipSellerOrderWithGhn(sellerId: string, orderId: string) {
    if (!this.ghnClientService) {
      throw new ServiceUnavailableException(
        'Dịch vụ Giao Hàng Nhanh chưa được khởi tạo',
      );
    }

    const result = await this.dataSource.transaction(
      'READ COMMITTED',
      async (manager) => {
        const order = await manager.getRepository(OrderEntity).findOne({
          where: { id: orderId, sellerId: sellerId.toLowerCase() },
          relations: { checkoutSession: true },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          throw new NotFoundException({
            errorCode: 'ORDER_NOT_FOUND',
            message:
              'Không tìm thấy đơn hàng hoặc bạn không có quyền xử lý đơn này',
          });
        }
        if (order.status !== 'PROCESSING') {
          throw new ConflictException({
            errorCode: 'ORDER_STATUS_INVALID',
            message: `Chỉ có thể giao đơn hàng đang ở trạng thái PROCESSING (hiện tại: ${order.status})`,
          });
        }

        order.items = await manager
          .getRepository(OrderItemEntity)
          .find({ where: { orderId: order.id } });

        // Chuẩn bị thông tin người nhận từ snapshot địa chỉ
        const snapshot = (order.shippingAddressSnapshot || {}) as Record<
          string,
          unknown
        >;
        const toName = String(
          snapshot.recipientName ||
            snapshot.fullName ||
            snapshot.name ||
            'Khách hàng Nexus',
        );
        const toPhone = String(snapshot.recipientPhone || '');
        const toAddress = String(snapshot.addressLine || '');
        const toWardName = String(snapshot.wardName || '');
        const toProvinceName = String(snapshot.provinceName || '');
        if (
          snapshot.addressScheme !== 'ghn_v3' ||
          typeof snapshot.recipientName !== 'string' ||
          !snapshot.recipientName.trim() ||
          !toPhone.trim() ||
          !toAddress.trim() ||
          !toWardName.trim() ||
          !toProvinceName.trim() ||
          !order.items?.length
        ) {
          throw new BadRequestException(
            'Địa chỉ giao hàng hoặc sản phẩm không hợp lệ',
          );
        }
        let totalWeight = 0;
        const names: string[] = [];
        for (const item of order.items) {
          const weight = item.weightGramsSnapshot;
          const name = item.productNameSnapshot?.trim();
          if (
            !Number.isSafeInteger(weight) ||
            weight! <= 0 ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity <= 0
          )
            throw new BadRequestException(
              'Order item has no valid shipping weight snapshot',
            );
          if (!name)
            throw new BadRequestException(
              'Product name is required for shipping',
            );
          names.push(name);
          totalWeight += weight! * item.quantity;
        }

        const ghnPayload = {
          recipientName: toName,
          recipientPhone: toPhone,
          addressLine: toAddress,
          provinceName: toProvinceName,
          wardName: toWardName,
          weightGrams: totalWeight,
          content: names.join(', '),
          clientOrderCode: order.id,
        };

        const ghnResult =
          await this.ghnClientService!.createNewAddressOrder(ghnPayload);

        const reasonDetails = `Đơn vị vận chuyển: GHN | Mã vận đơn: ${ghnResult.order_code}`;
        const shipped = await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'SHIPPED',
          actorId: sellerId,
          reason: reasonDetails,
        });

        await this.deductCodOrderStockOnShipment(
          manager,
          order,
          sellerId,
          `COD order shipped via GHN: ${ghnResult.order_code}`,
        );

        shipped.trackingCode = ghnResult.order_code;
        shipped.carrierName = 'GHN';
        const saved = await manager.getRepository(OrderEntity).save(shipped);

        return {
          orderId: order.id,
          status: 'SHIPPED' as const,
          trackingCode: saved.trackingCode ?? order.trackingCode,
          carrierName: saved.carrierName,
          totalFee: ghnResult.total_fee,
          expectedDeliveryTime: ghnResult.expected_delivery_time,
          printUrl: ghnResult.print_url,
          updatedAt: saved.updatedAt,
        };
      },
    );
    await this.notifyOrderStatus(orderId, 'ORDER_SHIPPED');
    return result;
  }

  /**
   * Cập nhật trạng thái giao hàng thành công (SHIPPED -> DELIVERED).
   * Dùng chung cho cả Webhook bưu tá GHN và nút xác nhận thủ công của Support Desk.
   */
  async markOrderAsDelivered(params: {
    orderId?: string;
    trackingCode?: string;
    actorId?: string | null;
    reason: string;
    source: 'CARRIER_WEBHOOK' | 'SUPPORT_MANUAL';
  }) {
    const result = await this.dataSource.transaction(
      'READ COMMITTED',
      async (manager) => {
        const orderRepo = manager.getRepository(OrderEntity);
        let order: OrderEntity | null = null;

        if (params.orderId) {
          const field = this.orderReferenceField(params.orderId);
          order = await orderRepo.findOne({
            where: { [field]: params.orderId },
          });
        } else if (params.trackingCode) {
          order = await orderRepo.findOne({
            where: { trackingCode: params.trackingCode },
          });
        }

        if (!order) {
          throw new NotFoundException({
            errorCode: 'ORDER_NOT_FOUND',
            message: params.orderId
              ? `Không tìm thấy đơn hàng với mã ID ${params.orderId}`
              : `Không tìm thấy đơn hàng với mã vận đơn ${params.trackingCode}`,
          });
        }

        // Idempotency: nếu đơn hàng đã ở trạng thái DELIVERED
        if (order.status === 'DELIVERED') {
          if (params.source === 'CARRIER_WEBHOOK') {
            return {
              orderId: order.id,
              orderNumber: order.orderNumber,
              status: 'DELIVERED' as const,
              trackingCode: order.trackingCode,
              deliveredAt: order.deliveredAt ?? order.updatedAt,
              alreadyDelivered: true,
              updatedAt: order.updatedAt,
            };
          }
          throw new ConflictException({
            errorCode: 'ORDER_STATUS_INVALID',
            message:
              'Chỉ có thể cập nhật DELIVERED cho đơn đang ở trạng thái SHIPPED (hiện tại: DELIVERED)',
          });
        }

        if (order.status !== 'SHIPPED') {
          throw new ConflictException({
            errorCode: 'ORDER_STATUS_INVALID',
            message: `Chỉ có thể cập nhật DELIVERED cho đơn đang ở trạng thái SHIPPED (hiện tại: ${order.status})`,
          });
        }

        const delivered = await this.orderStateMachine.transition(manager, {
          orderId: order.id,
          toStatus: 'DELIVERED',
          actorId: params.actorId ?? null,
          reason: params.reason,
        });

        delivered.deliveredAt = new Date();
        delivered.orderNumber = delivered.orderNumber ?? order.orderNumber;
        const saved = await orderRepo.save(delivered);

        return {
          orderId: saved.id,
          orderNumber: saved.orderNumber ?? order.orderNumber,
          status: 'DELIVERED' as const,
          trackingCode: saved.trackingCode ?? order.trackingCode,
          deliveredAt: saved.deliveredAt,
          alreadyDelivered: false,
          updatedAt: saved.updatedAt,
        };
      },
    );
    if (!result.alreadyDelivered) {
      await this.notifyOrderStatus(result.orderId, 'ORDER_DELIVERED');
    }
    return result;
  }

  /**
   * Cập nhật trạng thái giao hàng thành công từ Webhook bưu cục (SHIPPED -> DELIVERED)
   */
  async markOrderAsDeliveredViaCarrier(trackingCode: string) {
    return this.markOrderAsDelivered({
      trackingCode,
      actorId: null,
      reason: 'Webhook bưu tá GHN cập nhật giao hàng thành công',
      source: 'CARRIER_WEBHOOK',
    });
  }

  /**
   * Người mua tự bấm xác nhận đã nhận hàng (DELIVERED -> COMPLETED)
   */
  async confirmOrderDeliveryByBuyer(buyerId: string, orderReference: string) {
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const field = this.orderReferenceField(orderReference);
      const order = await orderRepo.findOne({
        where: { [field]: orderReference, buyerId },
      });

      if (!order) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message:
            'Không tìm thấy đơn hàng hoặc bạn không phải người mua đơn này',
        });
      }

      if (order.status !== 'DELIVERED') {
        throw new ConflictException({
          errorCode: 'ORDER_STATUS_INVALID',
          message: `Chỉ có thể xác nhận hoàn tất cho đơn hàng đang ở trạng thái DELIVERED (hiện tại: ${order.status})`,
        });
      }

      // Kiểm tra đơn hàng có khiếu nại ở bất kỳ trạng thái nào hay không
      const disputeCount = await manager
        .getRepository(OrderDisputeEntity)
        .count({ where: { orderId: order.id } });

      if (disputeCount > 0) {
        throw new ConflictException({
          errorCode: 'ORDER_HAS_DISPUTE',
          message:
            'Đơn hàng đang có hồ sơ khiếu nại, không thể tự xác nhận hoàn tất',
        });
      }

      const completed = await this.orderStateMachine.transition(manager, {
        orderId: order.id,
        toStatus: 'COMPLETED',
        actorId: buyerId,
        reason: 'Người mua xác nhận đã nhận được hàng và hài lòng',
      });

      const saved = await orderRepo.save(completed);

      return {
        orderId: saved.id,
        orderNumber: saved.orderNumber,
        status: 'COMPLETED' as const,
        updatedAt: saved.updatedAt,
      };
    });
  }

  /**
   * Lấy thông tin khiếu nại của đơn hàng cho Người mua
   */
  async getOrderDisputeByBuyer(userId: string, orderReference: string) {
    return loadBuyerOrderDispute({
      orderRepo: this.orderRepo,
      findDisputeByOrderId: async (orderId) =>
        typeof this.dataSource?.getRepository === 'function'
          ? this.dataSource
              .getRepository(OrderDisputeEntity)
              .findOne({ where: { orderId } })
          : null,
      userId,
      orderReference,
    });
  }

  private async notifyOrderStatus(
    orderId: string,
    type: 'ORDER_SHIPPED' | 'ORDER_DELIVERED',
  ): Promise<void> {
    try {
      const order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (!order) return;
      const title =
        type === 'ORDER_SHIPPED'
          ? 'Đơn hàng đang được giao'
          : 'Đơn hàng đã giao thành công';
      const content =
        type === 'ORDER_SHIPPED'
          ? `Đơn hàng ${order.orderNumber} đã được bàn giao cho đơn vị vận chuyển.`
          : `Đơn hàng ${order.orderNumber} đã được giao thành công.`;
      const recipients = [
        {
          userId: order.buyerId,
          type,
          title,
          content,
          actionUrl: `/orders/${order.id}`,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          sourceEventId: order.id,
        },
      ];
      if (type === 'ORDER_DELIVERED') {
        recipients.push({
          userId: order.sellerId,
          type,
          title,
          content,
          actionUrl: `/seller/orders/${order.id}`,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          sourceEventId: order.id,
        });
      }
      await this.notifications?.notifyMany(recipients);
    } catch (error) {
      this.logger.error(
        `Order ${orderId} status committed but notification dispatch failed`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async deductCodOrderStockOnShipment(
    manager: EntityManager,
    order: OrderEntity,
    sellerId: string,
    note: string,
  ): Promise<void> {
    const orderId = order.id;
    let paymentMethod =
      order.paymentMethod ?? order.checkoutSession?.paymentMethod ?? null;

    if (!paymentMethod && order.checkoutSessionId) {
      const sessionRepo = manager.getRepository(CheckoutSessionEntity);
      if (typeof sessionRepo?.findOne === 'function') {
        const session = await sessionRepo.findOne({
          select: { id: true, paymentMethod: true },
          where: { id: order.checkoutSessionId },
        });
        paymentMethod = session?.paymentMethod ?? null;
      }
    }

    const paymentRepo = manager.getRepository(PaymentEntity);
    const hasPaidPayment =
      typeof paymentRepo?.count === 'function'
        ? await paymentRepo.count({ where: { orderId, status: 'SUCCEEDED' } })
        : 0;

    const normalizedMethod = paymentMethod ? paymentMethod.toUpperCase() : null;

    if (normalizedMethod === 'COD') {
      if (hasPaidPayment === 0) {
        const itemRepo = manager.getRepository(OrderItemEntity);
        const items: OrderItemEntity[] =
          typeof itemRepo?.find === 'function'
            ? await itemRepo.find({
                select: { skuId: true, quantity: true, warehouseId: true },
                where: { orderId },
                order: { id: 'ASC' },
              })
            : [];
        if (
          items.length > 0 &&
          typeof this.inventoryReservation?.deduct === 'function'
        ) {
          await this.inventoryReservation.deduct(
            items.map((i: OrderItemEntity) => ({
              skuId: i.skuId,
              quantity: i.quantity,
              warehouseId: i.warehouseId ?? undefined,
            })),
            manager,
            {
              orderId,
              actorId: sellerId,
              note,
            },
          );
        }
      }
    } else if (hasPaidPayment === 0) {
      throw new ConflictException({
        errorCode: 'ORDER_PAYMENT_UNCONFIRMED',
        message: `Cannot ship order with payment method ${normalizedMethod ?? 'UNKNOWN'} without confirmed payment`,
      });
    }
  }
}
