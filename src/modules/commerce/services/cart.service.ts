import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CatalogCartApi } from '../../catalog/catalog-cart.api.js';
import { InventoryReadApi } from '../../fulfillment/inventory-read.api.js';
import { CartEntity } from '../domain/entities/cart.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { centsToMoney, moneyToCents } from './cart-money.js';
import { FlashDealQuotaService } from './flash-deal-quota.service.js';

type ExclusionReason = 'DISCONTINUED' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';
const reasons: Record<ExclusionReason, string> = {
  DISCONTINUED: 'Sản phẩm hoặc SKU đã ngừng bán',
  OUT_OF_STOCK: 'Hết hàng tại kho mặc định',
  INSUFFICIENT_STOCK: 'Kho mặc định không đủ số lượng yêu cầu',
};

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartEntity)
    private readonly carts: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItems: Repository<CartItemEntity>,
    private readonly catalog: CatalogCartApi,
    private readonly inventory: InventoryReadApi,
    private readonly flashDeals: FlashDealQuotaService,
  ) {}

  async getCart(userId: string, manager?: EntityManager) {
    const carts = manager ? manager.getRepository(CartEntity) : this.carts;
    const cart = await carts.findOne({
      where: { userId: userId.toLowerCase(), status: 'ACTIVE' },
    });
    const [{ observedTime }]: Array<{ observedTime: Date }> = await (
      manager ?? carts
    ).query('SELECT clock_timestamp() AS "observedTime"');
    return this.projectCart(
      cart && cart.expiresAt > observedTime ? cart : null,
      manager,
    );
  }

  async projectCart(cart: CartEntity | null, manager?: EntityManager) {
    const cartItems = manager
      ? manager.getRepository(CartItemEntity)
      : this.cartItems;
    const rows = cart
      ? await cartItems.find({
          where: { cartId: cart.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];
    const skuIds = rows.map((row) => row.skuId);
    const skus = new Map(
      (skuIds.length
        ? await this.catalog.getCartSkus(skuIds, manager)
        : []
      ).map((sku) => [sku.id, sku]),
    );
    const stocks = new Map(
      (skuIds.length
        ? await this.inventory.getDefaultWarehouseStock(skuIds, manager)
        : []
      ).map((stock) => [stock.skuId, stock.availableQuantity]),
    );
    const quantities = new Map<string, number>();
    for (const row of rows) {
      if (!row.reservedOrderId)
        quantities.set(
          row.skuId,
          (quantities.get(row.skuId) ?? 0) + row.quantity,
        );
    }
    const promotions = await this.flashDeals.projectForCart(
      [...skus.values()],
      quantities,
      cart?.userId ?? null,
      manager,
    );
    let subtotal = 0n;
    let currency: string | null = null;
    const items = rows.map((row) => {
      const sku = skus.get(row.skuId);
      const availableQuantity = stocks.get(row.skuId);
      if (availableQuantity === undefined) {
        throw new ServiceUnavailableException({
          errorCode: 'INVENTORY_UNAVAILABLE',
          message: 'Stock result is missing for a cart SKU',
        });
      }
      const promotion = row.reservedOrderId
        ? undefined
        : promotions.get(row.skuId);
      const currentPrice = sku
        ? moneyToCents(promotion?.flashDeal?.flashPrice ?? sku.price)
        : null;
      const snapshot = moneyToCents(row.unitPriceSnapshot);
      let exclusionReason: ExclusionReason | null = null;
      if (
        !sku ||
        sku.productId !== row.productId ||
        !sku.isActive ||
        sku.productStatus !== 'ACTIVE' ||
        sku.productDeletedAt !== null
      ) {
        exclusionReason = 'DISCONTINUED';
      } else if (availableQuantity === 0) {
        exclusionReason = 'OUT_OF_STOCK';
      } else if (availableQuantity < row.quantity) {
        exclusionReason = 'INSUFFICIENT_STOCK';
      }
      const lineTotal =
        currentPrice === null ? null : currentPrice * BigInt(row.quantity);
      const isReserved = Boolean(row.reservedOrderId);
      if (
        exclusionReason === null &&
        !isReserved &&
        sku &&
        lineTotal !== null
      ) {
        if (currency !== null && currency !== sku.currency) {
          throw new ConflictException({
            errorCode: 'CART_CURRENCY_MISMATCH',
            message: 'Cannot subtotal cart items in different currencies',
          });
        }
        currency = sku.currency;
        subtotal += lineTotal;
      }
      return {
        id: row.id,
        skuId: row.skuId,
        productId: row.productId,
        productName: sku?.productName ?? row.productNameSnapshot,
        productSlug: sku?.productSlug ?? null,
        imageUrl: sku?.primaryImageUrl ?? null,
        primaryImageUrl: sku?.primaryImageUrl ?? null,
        skuCode: sku?.skuCode ?? null,
        variantAttributes: sku?.variantAttributes ?? null,
        quantity: row.quantity,
        currency: sku?.currency ?? null,
        unitPrice: currentPrice === null ? null : centsToMoney(currentPrice),
        unitPriceSnapshot: centsToMoney(snapshot),
        lineTotal: lineTotal === null ? null : centsToMoney(lineTotal),
        priceChanged: currentPrice === null ? null : currentPrice !== snapshot,
        availableQuantity,
        includedInSubtotal: exclusionReason === null && !isReserved,
        exclusionReason,
        warning: exclusionReason
          ? reasons[exclusionReason]
          : (promotion?.warning ?? null),
        flashDeal: promotion?.flashDeal ?? null,
        flashDealWarningCode: promotion?.warningCode ?? null,
        isReserved,
        reservedOrderId: row.reservedOrderId,
        reservationExpiresAt: row.reservationExpiresAt,
      };
    });
    const excludedItemCount = items.filter(
      (item) => !item.includedInSubtotal,
    ).length;
    return {
      cartId: cart?.id ?? null,
      expiresAt: cart?.expiresAt ?? null,
      items,
      currency,
      subtotal: centsToMoney(subtotal),
      hasExcludedItems: excludedItemCount > 0,
      excludedItemCount,
    };
  }
}
