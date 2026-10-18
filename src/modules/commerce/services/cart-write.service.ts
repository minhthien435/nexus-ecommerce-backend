import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { CatalogCartApi } from '../../catalog/catalog-cart.api.js';
import type { CartSku } from '../../catalog/catalog-cart.api.js';
import { InventoryReadApi } from '../../fulfillment/inventory-read.api.js';
import type { CartMergeResult, GuestCartItem } from '../cart-merge.api.js';
import { CartEntity } from '../domain/entities/cart.entity.js';
import { CartItemEntity } from '../domain/entities/cart-item.entity.js';
import { AddCartItemDto } from '../dtos/add-cart-item.dto.js';
import { UpdateCartItemDto } from '../dtos/update-cart-item.dto.js';
import { centsToMoney, moneyToCents } from './cart-money.js';
import { CartService } from './cart.service.js';

const MAX_QUANTITY = 2147483647;

@Injectable()
export class CartWriteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reader: CartService,
    private readonly catalog: CatalogCartApi,
    private readonly inventory: InventoryReadApi,
  ) {}

  async addItem(userId: string, input: AddCartItemDto) {
    if (
      !isUUID(userId) ||
      !isUUID(input.skuId) ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > MAX_QUANTITY
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_CART_ITEM',
        message: 'A valid account, SKU and integer quantity are required',
      });
    }
    userId = userId.toLowerCase();
    const skuId = input.skuId.toLowerCase();
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const observedTime = await this.lockAccountAndObserveTime(
        manager,
        userId,
      );
      const expirationDays = await this.expirationDays(manager);
      const carts = manager.getRepository(CartEntity);
      const items = manager.getRepository(CartItemEntity);
      const previous = await carts.findOne({
        where: { userId, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      let cart =
        previous && previous.expiresAt > observedTime ? previous : null;
      const existing = cart
        ? await items.findOne({
            where: { cartId: cart.id, skuId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      if (quantity > MAX_QUANTITY) {
        throw new BadRequestException({
          errorCode: 'CART_QUANTITY_OVERFLOW',
          message: 'Accumulated quantity exceeds the supported integer limit',
        });
      }
      const [sku] = await this.catalog.getCartSkus([skuId], manager);
      if (!sku || sku.id !== skuId) {
        throw new NotFoundException({
          errorCode: 'SKU_NOT_FOUND',
          message: 'SKU was not found',
        });
      }
      if (!this.isAvailable(sku, existing)) {
        throw new ConflictException({
          errorCode: 'SKU_UNAVAILABLE',
          message: 'Product or SKU is no longer available',
        });
      }
      const stock = await this.stocks([skuId], manager);
      if (stock.get(skuId)! < quantity) {
        throw new ConflictException({
          errorCode: 'INSUFFICIENT_STOCK',
          message:
            'The default warehouse cannot supply the accumulated quantity',
        });
      }
      if (!cart) {
        cart = await this.createCart(
          manager,
          userId,
          previous,
          observedTime,
          expirationDays,
        );
      }
      await this.writeItem(manager, cart, sku, existing, quantity);
      const result = await this.reader.projectCart(cart, manager);
      this.assertProjectedItem(result, skuId, quantity);
      return result;
    });
  }

  async mergeItems(
    userId: string,
    input: readonly GuestCartItem[],
  ): Promise<CartMergeResult> {
    if (
      !isUUID(userId) ||
      !Array.isArray(input) ||
      input.length > 100 ||
      input.some(
        (row) =>
          !row ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          Object.keys(row).some(
            (key) => key !== 'skuId' && key !== 'quantity',
          ) ||
          !isUUID(row.skuId) ||
          !Number.isInteger(row.quantity) ||
          row.quantity < 1 ||
          row.quantity > MAX_QUANTITY,
      )
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_CART_ITEM',
        message: 'Valid guest SKU and integer quantities are required',
      });
    }
    const empty: CartMergeResult = {
      status: 'skipped',
      accepted: [],
      skipped: [],
    };
    if (input.length === 0) return empty;
    userId = userId.toLowerCase();
    const grouped = new Map<string, bigint>();
    for (const row of input) {
      const skuId = row.skuId.toLowerCase();
      grouped.set(skuId, (grouped.get(skuId) ?? 0n) + BigInt(row.quantity));
    }
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const observedTime = await this.lockAccountAndObserveTime(
        manager,
        userId,
      );
      const expirationDays = await this.expirationDays(manager);
      const carts = manager.getRepository(CartEntity);
      const items = manager.getRepository(CartItemEntity);
      const previous = await carts.findOne({
        where: { userId, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      let cart =
        previous && previous.expiresAt > observedTime ? previous : null;
      const skuIds = [...grouped.keys()];
      const skus = new Map(
        (await this.catalog.getCartSkus(skuIds, manager)).map((sku) => [
          sku.id,
          sku,
        ]),
      );
      const stocks = await this.stocks(skuIds, manager);
      const result: CartMergeResult = {
        status: 'skipped',
        accepted: [],
        skipped: [],
      };
      const accepted: Array<{
        sku: CartSku;
        existing: CartItemEntity | null;
        quantity: number;
      }> = [];
      for (const [skuId, quantityAdded] of grouped) {
        const existing = cart
          ? await items.findOne({
              where: { cartId: cart.id, skuId },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        const quantity = quantityAdded + BigInt(existing?.quantity ?? 0);
        const sku = skus.get(skuId);
        const reason =
          quantity > BigInt(MAX_QUANTITY)
            ? 'CART_QUANTITY_OVERFLOW'
            : !sku
              ? 'SKU_NOT_FOUND'
              : !this.isAvailable(sku, existing)
                ? 'SKU_UNAVAILABLE'
                : stocks.get(skuId)! < Number(quantity)
                  ? 'INSUFFICIENT_STOCK'
                  : null;
        if (reason) {
          result.skipped.push({ skuId, reason });
        } else {
          accepted.push({ sku: sku!, existing, quantity: Number(quantity) });
          result.accepted.push({
            skuId,
            quantityAdded: Number(quantityAdded),
            quantity: Number(quantity),
          });
        }
      }
      // No acceptance means even an overdue ACTIVE predecessor stays untouched.
      if (accepted.length === 0) return result;
      if (!cart)
        cart = await this.createCart(
          manager,
          userId,
          previous,
          observedTime,
          expirationDays,
        );
      for (const row of accepted)
        await this.writeItem(
          manager,
          cart,
          row.sku,
          row.existing,
          row.quantity,
        );
      result.cart = await this.reader.projectCart(cart, manager);
      for (const row of result.accepted)
        this.assertProjectedItem(result.cart, row.skuId, row.quantity);
      result.status = result.skipped.length ? 'partial' : 'merged';
      return result;
    });
  }

  async updateItem(userId: string, skuId: string, input: UpdateCartItemDto) {
    if (
      !isUUID(userId) ||
      !isUUID(skuId) ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 0 ||
      input.quantity > MAX_QUANTITY
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_CART_ITEM',
        message: 'A valid account, SKU and integer quantity are required',
      });
    }
    userId = userId.toLowerCase();
    skuId = skuId.toLowerCase();
    const quantity = input.quantity;
    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const observedTime = await this.lockAccountAndObserveTime(
        manager,
        userId,
      );
      const carts = manager.getRepository(CartEntity);
      const items = manager.getRepository(CartItemEntity);
      const cart = await carts.findOne({
        where: { userId, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cart || cart.expiresAt <= observedTime) {
        throw new NotFoundException({
          errorCode: 'CART_NOT_FOUND',
          message: 'An active, unexpired cart was not found',
        });
      }
      const existing = await items.findOne({
        where: { cartId: cart.id, skuId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) {
        throw new NotFoundException({
          errorCode: 'CART_ITEM_NOT_FOUND',
          message: 'The requested cart item was not found',
        });
      }
      if (quantity === 0) {
        await items.delete(existing.id);
        return this.reader.projectCart(cart, manager);
      }
      const [sku] = await this.catalog.getCartSkus([skuId], manager);
      if (!sku || sku.id !== skuId) {
        throw new NotFoundException({
          errorCode: 'SKU_NOT_FOUND',
          message: 'SKU was not found',
        });
      }
      if (!this.isAvailable(sku, existing)) {
        throw new ConflictException({
          errorCode: 'SKU_UNAVAILABLE',
          message: 'Product or SKU is no longer available',
        });
      }
      const stock = await this.stocks([skuId], manager);
      if (stock.get(skuId)! < quantity) {
        throw new ConflictException({
          errorCode: 'INSUFFICIENT_STOCK',
          message: 'The default warehouse cannot supply the requested quantity',
        });
      }
      await this.writeItem(manager, cart, sku, existing, quantity);
      const result = await this.reader.projectCart(cart, manager);
      this.assertProjectedItem(result, skuId, quantity);
      return result;
    });
  }

  private async expirationDays(manager: EntityManager) {
    const configs: Array<{ value: unknown }> = await manager.query(
      'SELECT config_value AS value FROM commerce.service_configs WHERE config_key = $1 AND value_type = $2',
      ['CART_EXPIRATION_DAYS', 'INTEGER'],
    );
    if (configs.length !== 1 || configs[0].value !== 7) {
      throw new ServiceUnavailableException({
        errorCode: 'CART_EXPIRATION_NOT_CONFIGURED',
        message:
          'Expected numeric CART_EXPIRATION_DAYS configuration equal to 7',
      });
    }
    return configs[0].value;
  }

  private isAvailable(sku: CartSku, existing: CartItemEntity | null) {
    return (
      sku.isActive &&
      sku.productStatus === 'ACTIVE' &&
      sku.productDeletedAt === null &&
      (!existing || existing.productId === sku.productId)
    );
  }

  private async stocks(skuIds: string[], manager: EntityManager) {
    const stocks = new Map(
      (await this.inventory.getDefaultWarehouseStock(skuIds, manager)).map(
        (row) => [row.skuId, row.availableQuantity],
      ),
    );
    if (skuIds.some((skuId) => !stocks.has(skuId))) {
      throw new ServiceUnavailableException({
        errorCode: 'INVENTORY_UNAVAILABLE',
        message: 'Stock result is missing for the requested SKU',
      });
    }
    return stocks;
  }

  private async createCart(
    manager: EntityManager,
    userId: string,
    previous: CartEntity | null,
    observedTime: Date,
    expirationDays: number,
  ) {
    const carts = manager.getRepository(CartEntity);
    if (previous) await carts.update(previous.id, { status: 'EXPIRED' });
    return carts.save(
      carts.create({
        userId,
        guestToken: null,
        status: 'ACTIVE',
        createdAt: observedTime,
        expiresAt: new Date(
          observedTime.getTime() + expirationDays * 24 * 60 * 60 * 1000,
        ),
      }),
    );
  }

  private async writeItem(
    manager: EntityManager,
    cart: CartEntity,
    sku: CartSku,
    existing: CartItemEntity | null,
    quantity: number,
  ) {
    const items = manager.getRepository(CartItemEntity);
    if (existing) {
      await items.update(existing.id, { quantity });
    } else {
      await items.save(
        items.create({
          cartId: cart.id,
          skuId: sku.id,
          productId: sku.productId,
          sellerId: sku.sellerId,
          quantity,
          unitPriceSnapshot: centsToMoney(moneyToCents(sku.price)),
          productNameSnapshot: sku.productName,
        }),
      );
    }
  }

  private assertProjectedItem(
    result: Awaited<ReturnType<CartService['projectCart']>>,
    skuId: string,
    quantity: number,
  ) {
    const requested = result.items.find((row) => row.skuId === skuId);
    if (
      !requested ||
      requested.quantity !== quantity ||
      !requested.includedInSubtotal
    ) {
      throw new ConflictException({
        errorCode: 'CART_ITEM_CHANGED',
        message: 'Requested item became unavailable during cart projection',
      });
    }
  }

  private async lockAccountAndObserveTime(
    manager: EntityManager,
    userId: string,
  ) {
    // Transaction-scoped lock also serializes creation when no cart row exists.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`commerce:cart:${userId}`],
    );
    const [{ observedTime }]: Array<{ observedTime: Date }> =
      await manager.query('SELECT clock_timestamp() AS "observedTime"');
    return observedTime;
  }
}
