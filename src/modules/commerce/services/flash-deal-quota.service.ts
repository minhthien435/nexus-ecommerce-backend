import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  CatalogCartApi,
  type CartSku,
} from '../../catalog/catalog-cart.api.js';
import { moneyToCents } from './cart-money.js';

export interface FlashDealReserveInput {
  buyerId: string;
  orders: Array<{
    orderId: string;
    items: Array<{ itemId: string; skuId: string; quantity: number }>;
  }>;
}
export interface FlashDealExpectation {
  cartItemId: string;
  flashDealItemId: string;
  expectedUnitPrice: string;
}
export interface ResolvedFlashDeal {
  cartItemId: string;
  itemId: string;
  skuId: string;
  quantity: number;
  unitPrice: string;
}
interface Deal {
  id: string;
  campaignId: string;
  skuId: string;
  productId: string;
  sellerId: string;
  flashPrice: string;
  regularPrice: string;
  quotaQty: number;
  soldQty: number;
  maxPerBuyer: number;
  status: string;
  campaignStatus: string;
  startsAt: Date;
  endsAt: Date;
}
interface Reservation {
  itemId: string;
  buyerId: string;
  quantity: number;
  status: string;
}
interface LockedOrder {
  id: string;
  buyerId: string;
  sellerId: string;
  source: string;
  status: string;
}
export interface CartFlashDealProjection {
  flashDeal: {
    itemId: string;
    flashPrice: string;
    regularPrice: string;
    remainingQuota: number;
    maxPerBuyer: number;
    endsAt: Date;
  } | null;
  warning: string | null;
  warningCode: string | null;
}
const dealColumns = `i.id, i.campaign_id AS "campaignId", i.sku_id AS "skuId",
  i.product_id AS "productId", i.seller_id AS "sellerId", i.flash_price AS "flashPrice",
  i.original_price_snapshot AS "regularPrice", i.quota_qty AS "quotaQty", i.sold_qty AS "soldQty",
  i.max_per_buyer AS "maxPerBuyer", i.status, c.status AS "campaignStatus",
  c.starts_at AS "startsAt", c.ends_at AS "endsAt"`;

@Injectable()
export class FlashDealQuotaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: CatalogCartApi,
  ) {}

  async resolveForCheckout(
    manager: EntityManager,
    cartItems: Array<{ id: string; skuId: string; quantity: number }>,
    skus: CartSku[],
    expectations: FlashDealExpectation[] = [],
  ): Promise<Map<string, ResolvedFlashDeal>> {
    this.requireTransaction(manager);
    if (
      new Set(expectations.map((value) => value.cartItemId)).size !==
      expectations.length
    )
      this.fail('EXPECTATION_DUPLICATE');
    const cartById = new Map(cartItems.map((item) => [item.id, item]));
    if (expectations.some((value) => !cartById.has(value.cartItemId)))
      this.fail('IDENTITY_MISMATCH');
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));
    const deals = (await manager.query(
      `SELECT ${dealColumns} FROM catalog.flash_deal_items i JOIN catalog.flash_deal_campaigns c ON c.id=i.campaign_id WHERE i.sku_id = ANY($1::uuid[]) ORDER BY i.id`,
      [cartItems.map((item) => item.skuId)],
    )) as Deal[];
    const now = await this.databaseTime(manager);
    const expectedByCart = new Map(
      expectations.map((value) => [value.cartItemId, value]),
    );
    const resolved = new Map<string, ResolvedFlashDeal>();
    for (const cartItem of cartItems) {
      const expectation = expectedByCart.get(cartItem.id);
      const sku = skuById.get(cartItem.skuId);
      const running = deals.filter(
        (deal) =>
          deal.skuId === cartItem.skuId &&
          deal.status === 'ACTIVE' &&
          deal.campaignStatus === 'ACTIVE' &&
          deal.startsAt <= now &&
          deal.endsAt > now,
      );
      let deal: Deal | undefined;
      if (expectation) {
        deal = deals.find(
          (candidate) => candidate.id === expectation.flashDealItemId,
        );
        if (
          !deal ||
          deal.skuId !== cartItem.skuId ||
          !sku ||
          !this.validSku(deal, sku)
        )
          this.fail('IDENTITY_MISMATCH');
        const unavailable = this.unavailableReason(deal, now);
        if (unavailable) this.fail(unavailable);
        try {
          if (
            moneyToCents(expectation.expectedUnitPrice) !==
            moneyToCents(deal.flashPrice)
          )
            this.fail('PRICE_CHANGED');
        } catch {
          this.fail('PRICE_CHANGED');
        }
      } else {
        if (running.length > 1) this.fail('AMBIGUOUS');
        deal = running[0];
        if (!deal) continue;
        if (!sku || !this.validSku(deal, sku)) this.fail('IDENTITY_MISMATCH');
        const unavailable = this.unavailableReason(deal, now);
        if (unavailable) this.fail(unavailable);
      }
      resolved.set(cartItem.id, {
        cartItemId: cartItem.id,
        itemId: deal.id,
        skuId: cartItem.skuId,
        quantity: cartItem.quantity,
        unitPrice: deal.flashPrice,
      });
    }
    return resolved;
  }

  /**
   * Internal only. Supply the entire batch: all orders are locked in UUID order before any deal locks.
   * A caller that already holds order locks must have acquired the entire batch in that same order;
   * callers must not hold deal locks before entering this method. Propagate failures to roll back.
   */
  async reserve(
    manager: EntityManager,
    input: FlashDealReserveInput,
  ): Promise<void> {
    this.requireTransaction(manager);
    const orderIds = input.orders.map((order) => order.orderId);
    if (
      !input.buyerId ||
      !orderIds.length ||
      new Set(orderIds).size !== orderIds.length ||
      input.orders.some((order) => !order.items.length)
    )
      this.fail('INVALID_REQUEST');
    const orders = await this.lockOrders(manager, orderIds);
    if (orders.length !== orderIds.length) this.fail('ORDER_NOT_FOUND');
    const lines = input.orders.flatMap((order) =>
      order.items.map((item) => ({ ...item, orderId: order.orderId })),
    );
    const keys = lines.map((line) => `${line.orderId}/${line.itemId}`);
    if (
      new Set(lines.map((line) => `${line.orderId}/${line.skuId}`)).size !==
      lines.length
    )
      this.fail('ITEM_MISMATCH');
    if (
      new Set(keys).size !== keys.length ||
      lines.some(
        (line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0,
      )
    )
      this.fail('INVALID_QUANTITY');
    const deals = await this.lockDeals(
      manager,
      lines.map((line) => line.itemId),
    );
    const now = await this.databaseTime(manager);
    const skus = new Map(
      (
        await this.catalog.getCartSkus(
          lines.map((line) => line.skuId),
          manager,
        )
      ).map((sku) => [sku.id, sku]),
    );
    const existing = (await manager.query(
      `SELECT order_id AS "orderId", flash_deal_item_id AS "itemId", buyer_id AS "buyerId", quantity, status FROM catalog.flash_deal_reservations WHERE order_id = ANY($1::uuid[])`,
      [orderIds],
    )) as Array<Reservation & { orderId: string }>;
    // Exact retries may succeed after a campaign ends, but never after release or with a different request.
    if (existing.length) {
      if (
        existing.length !== lines.length ||
        existing.some(
          (r) =>
            r.buyerId !== input.buyerId ||
            r.status === 'RELEASED' ||
            !lines.some(
              (line) =>
                line.orderId === r.orderId &&
                line.itemId === r.itemId &&
                line.quantity === r.quantity &&
                deals.find((d) => d.id === r.itemId)?.skuId === line.skuId,
            ),
        )
      )
        this.fail('RESERVATION_RETRY_MISMATCH');
      for (const order of orders)
        if (
          order.buyerId !== input.buyerId ||
          order.source !== 'CART' ||
          ['CANCELLED', 'REFUNDED'].includes(order.status)
        )
          this.fail('ORDER_MISMATCH');
      return;
    }
    const usages = await this.buyerUsage(
      manager,
      input.buyerId,
      deals.map((deal) => deal.id),
    );
    const requested = new Map<string, number>();
    const persistedLines = (await manager.query(
      `SELECT order_id AS "orderId", sku_id AS "skuId", product_id AS "productId", quantity, unit_price AS "unitPrice" FROM commerce.order_items WHERE order_id = ANY($1::uuid[])`,
      [orderIds],
    )) as Array<{
      orderId: string;
      skuId: string;
      productId: string;
      quantity: number;
      unitPrice: string;
    }>;
    for (const line of lines) {
      const deal = deals.find((d) => d.id === line.itemId);
      const order = orders.find((o) => o.id === line.orderId)!;
      const sku = skus.get(line.skuId);
      if (
        order.buyerId !== input.buyerId ||
        order.source !== 'CART' ||
        !['PENDING_PAYMENT', 'PROCESSING'].includes(order.status)
      )
        this.fail('ORDER_MISMATCH');
      if (
        !deal ||
        !sku ||
        deal.skuId !== sku.id ||
        !this.validSku(deal, sku) ||
        deal.sellerId !== order.sellerId
      )
        this.fail('ITEM_MISMATCH');
      const orderLines = persistedLines.filter(
        (row) => row.orderId === line.orderId && row.skuId === line.skuId,
      );
      if (
        orderLines.reduce((sum, row) => sum + row.quantity, 0) !==
          line.quantity ||
        orderLines.some(
          (row) =>
            row.productId !== deal.productId ||
            moneyToCents(row.unitPrice) !== moneyToCents(deal.flashPrice),
        )
      )
        this.fail('ORDER_ITEM_MISMATCH');
      const unavailable = this.unavailableReason(deal, now);
      if (unavailable) this.fail(unavailable);
      requested.set(deal.id, (requested.get(deal.id) ?? 0) + line.quantity);
    }
    for (const deal of deals) {
      const quantity = requested.get(deal.id)!;
      if (quantity > deal.quotaQty - deal.soldQty) this.fail('SOLD_OUT');
      if (quantity + (usages.get(deal.id) ?? 0) > deal.maxPerBuyer)
        this.fail('LIMIT_EXCEEDED');
    }
    // Validate the full locked batch before mutating. Any subsequent failure propagates to the caller transaction.
    for (const deal of deals) {
      const changed = (await manager.query(
        `WITH changed AS (UPDATE catalog.flash_deal_items SET sold_qty=sold_qty+$2, updated_at=clock_timestamp() WHERE id=$1 AND sold_qty+$2<=quota_qty RETURNING id) SELECT id FROM changed`,
        [deal.id, requested.get(deal.id)],
      )) as Array<{ id: string }>;
      if (changed.length !== 1) this.fail('SOLD_OUT');
    }
    for (const line of lines)
      await manager.query(
        `INSERT INTO catalog.flash_deal_reservations(flash_deal_item_id,order_id,buyer_id,quantity,status) VALUES ($1,$2,$3,$4,$5)`,
        [
          line.itemId,
          line.orderId,
          input.buyerId,
          line.quantity,
          orders.find((order) => order.id === line.orderId)?.status ===
          'PROCESSING'
            ? 'COMMITTED'
            : 'RESERVED',
        ],
      );
  }

  async commitByOrderId(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    this.requireTransaction(manager);
    const orders = await this.lockOrders(manager, [orderId]);
    const rows = await this.lockOrderDeals(manager, orderId);
    if (!rows.length) return;
    if (
      !orders[0] ||
      orders[0].source !== 'CART' ||
      orders[0].status !== 'PAID'
    )
      this.fail('ORDER_MISMATCH');
    if (
      rows.some(
        (row) => row.status === 'RELEASED' || row.buyerId !== orders[0].buyerId,
      )
    )
      this.fail('RESERVATION_RELEASED');
    await manager.query(
      `UPDATE catalog.flash_deal_reservations SET status='COMMITTED', updated_at=clock_timestamp() WHERE order_id=$1 AND status='RESERVED'`,
      [orderId],
    );
  }

  /** Acquire the complete lock union before a caller transitions several orders. */
  async prelockByOrderIds(
    manager: EntityManager,
    orderIds: string[],
  ): Promise<void> {
    this.requireTransaction(manager);
    if (!orderIds.length) return;
    await this.lockOrders(manager, orderIds);
    const rows = (await manager.query(
      `SELECT DISTINCT flash_deal_item_id AS "itemId" FROM catalog.flash_deal_reservations WHERE order_id = ANY($1::uuid[]) ORDER BY flash_deal_item_id`,
      [orderIds],
    )) as Array<{ itemId: string }>;
    if (rows.length)
      await this.lockDeals(
        manager,
        rows.map((row) => row.itemId),
      );
  }

  async releaseByOrderId(
    manager: EntityManager,
    orderId: string,
    reservedOnly = false,
  ): Promise<void> {
    this.requireTransaction(manager);
    await this.lockOrders(manager, [orderId]);
    const rows = await this.lockOrderDeals(manager, orderId);
    if (!rows.length) return;
    const released = (await manager.query(
      `WITH changed AS (UPDATE catalog.flash_deal_reservations SET status='RELEASED', updated_at=clock_timestamp() WHERE order_id=$1 AND status = ANY($2::varchar[]) RETURNING flash_deal_item_id AS "itemId", quantity) SELECT * FROM changed`,
      [orderId, reservedOnly ? ['RESERVED'] : ['RESERVED', 'COMMITTED']],
    )) as Array<{ itemId: string; quantity: number }>;
    const quantities = new Map<string, number>();
    for (const row of released)
      quantities.set(
        row.itemId,
        (quantities.get(row.itemId) ?? 0) + row.quantity,
      );
    for (const [itemId, quantity] of [...quantities].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const changed = (await manager.query(
        `WITH changed AS (UPDATE catalog.flash_deal_items SET sold_qty=sold_qty-$2, updated_at=clock_timestamp() WHERE id=$1 AND sold_qty >= $2 RETURNING id) SELECT id FROM changed`,
        [itemId, quantity],
      )) as Array<{ id: string }>;
      if (changed.length !== 1)
        throw new InternalServerErrorException({
          errorCode: 'FLASH_DEAL_COUNTER_UNDERFLOW',
          message: 'Flash deal quota counter invariant violated',
        });
    }
  }

  async projectForCart(
    skus: CartSku[],
    quantities: Map<string, number>,
    buyerId: string | null,
    manager?: EntityManager,
  ): Promise<Map<string, CartFlashDealProjection>> {
    const result = new Map<string, CartFlashDealProjection>();
    if (!skus.length) return result;
    const reader = manager ?? this.dataSource.manager;
    const deals = (await reader.query(
      `SELECT ${dealColumns} FROM catalog.flash_deal_items i JOIN catalog.flash_deal_campaigns c ON c.id=i.campaign_id WHERE i.sku_id = ANY($1::uuid[]) ORDER BY i.id`,
      [skus.map((sku) => sku.id)],
    )) as Deal[];
    if (!deals.length) return result;
    const now = await this.databaseTime(reader);
    const usage = buyerId
      ? await this.buyerUsage(
          reader,
          buyerId,
          deals.map((deal) => deal.id),
        )
      : new Map<string, number>();
    for (const sku of skus) {
      const candidates = deals.filter((deal) => deal.skuId === sku.id);
      if (!candidates.length) continue;
      const eligible = candidates.filter(
        (deal) =>
          this.validSku(deal, sku) && !this.unavailableReason(deal, now),
      );
      let warningCode: string | null = null;
      let chosen: Deal | undefined;
      if (eligible.length > 1) warningCode = 'AMBIGUOUS';
      else if (eligible.length === 1) {
        chosen = eligible[0];
        const quantity = quantities.get(sku.id) ?? 0;
        if (!buyerId) warningCode = 'SIGN_IN_REQUIRED';
        else if (quantity > chosen.quotaQty - chosen.soldQty)
          warningCode = 'SOLD_OUT';
        else if (quantity + (usage.get(chosen.id) ?? 0) > chosen.maxPerBuyer)
          warningCode = 'LIMIT_EXCEEDED';
      } else
        warningCode = candidates.some((deal) => !this.validSku(deal, sku))
          ? 'INVALID'
          : this.unavailableReason(candidates[0], now);
      result.set(sku.id, {
        flashDeal:
          chosen && !warningCode
            ? {
                itemId: chosen.id,
                flashPrice: chosen.flashPrice,
                regularPrice: chosen.regularPrice,
                remainingQuota: chosen.quotaQty - chosen.soldQty,
                maxPerBuyer: chosen.maxPerBuyer,
                endsAt: chosen.endsAt,
              }
            : null,
        warningCode: warningCode ? `FLASH_DEAL_${warningCode}` : null,
        warning: warningCode
          ? `Flash deal unavailable: ${warningCode.toLowerCase().replaceAll('_', ' ')}`
          : null,
      });
    }
    return result;
  }

  private validSku(deal: Deal, sku: CartSku): boolean {
    return (
      deal.skuId === sku.id &&
      deal.productId === sku.productId &&
      deal.sellerId === sku.sellerId &&
      sku.isActive &&
      sku.productStatus === 'ACTIVE' &&
      sku.productDeletedAt === null
    );
  }
  private unavailableReason(deal: Deal, now: Date): string | null {
    if (deal.endsAt <= now || deal.campaignStatus === 'ENDED') return 'ENDED';
    if (deal.startsAt > now || deal.campaignStatus === 'SCHEDULED')
      return 'UPCOMING';
    if (deal.status === 'PAUSED') return 'PAUSED';
    if (deal.status !== 'ACTIVE' || deal.campaignStatus !== 'ACTIVE')
      return 'INVALID';
    try {
      if (
        moneyToCents(deal.flashPrice) <= 0n ||
        moneyToCents(deal.flashPrice) >= moneyToCents(deal.regularPrice)
      )
        return 'INVALID';
    } catch {
      return 'INVALID';
    }
    if (deal.soldQty >= deal.quotaQty) return 'SOLD_OUT';
    return null;
  }
  private async lockOrders(
    manager: EntityManager,
    ids: string[],
  ): Promise<LockedOrder[]> {
    return manager.query(
      `SELECT id, buyer_id AS "buyerId", seller_id AS "sellerId", source, status FROM commerce.orders WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[...new Set(ids)].sort()],
    );
  }
  private async lockDeals(
    manager: EntityManager,
    ids: string[],
  ): Promise<Deal[]> {
    const keys = [...new Set(ids)].sort();
    const campaigns = (await manager.query(
      `SELECT DISTINCT campaign_id AS id FROM catalog.flash_deal_items WHERE id = ANY($1::uuid[]) ORDER BY campaign_id`,
      [keys],
    )) as Array<{ id: string }>;
    const campaignIds = campaigns.map((row) => row.id);
    await manager.query(
      `SELECT id FROM catalog.flash_deal_campaigns WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [campaignIds],
    );
    const deals = (await manager.query(
      `SELECT ${dealColumns} FROM catalog.flash_deal_items i JOIN catalog.flash_deal_campaigns c ON c.id=i.campaign_id WHERE i.id = ANY($1::uuid[]) ORDER BY i.id FOR UPDATE OF i`,
      [keys],
    )) as Deal[];
    if (
      deals.length !== keys.length ||
      deals.some((deal) => !campaignIds.includes(deal.campaignId))
    )
      this.fail('ITEM_MISMATCH');
    return deals;
  }
  private async lockOrderDeals(
    manager: EntityManager,
    orderId: string,
  ): Promise<Reservation[]> {
    const rows = (await manager.query(
      `SELECT flash_deal_item_id AS "itemId", buyer_id AS "buyerId", quantity, status FROM catalog.flash_deal_reservations WHERE order_id=$1 ORDER BY flash_deal_item_id`,
      [orderId],
    )) as Reservation[];
    if (rows.length)
      await this.lockDeals(
        manager,
        rows.map((row) => row.itemId),
      );
    return rows;
  }
  private async buyerUsage(
    manager: EntityManager,
    buyerId: string,
    itemIds: string[],
  ): Promise<Map<string, number>> {
    const rows = (await manager.query(
      `SELECT flash_deal_item_id AS "itemId", SUM(quantity)::text AS quantity FROM catalog.flash_deal_reservations WHERE buyer_id=$1 AND flash_deal_item_id = ANY($2::uuid[]) AND status IN ('RESERVED','COMMITTED') GROUP BY flash_deal_item_id`,
      [buyerId, itemIds],
    )) as Array<{ itemId: string; quantity: string }>;
    return new Map(rows.map((row) => [row.itemId, Number(row.quantity)]));
  }
  private async databaseTime(manager: EntityManager): Promise<Date> {
    const rows = (await manager.query(
      'SELECT clock_timestamp() AS "observedTime"',
    )) as Array<{ observedTime: Date }>;
    if (!(rows[0]?.observedTime instanceof Date))
      throw new InternalServerErrorException(
        'Flash deal database clock unavailable',
      );
    return rows[0].observedTime;
  }
  private requireTransaction(manager: EntityManager): void {
    if (!manager.queryRunner?.isTransactionActive)
      throw new InternalServerErrorException({
        errorCode: 'FLASH_DEAL_TRANSACTION_REQUIRED',
        message:
          'Flash deal mutations require an active caller-owned transaction',
      });
  }
  private fail(code: string): never {
    throw new ConflictException({
      errorCode: `FLASH_DEAL_${code}`,
      message: `Flash deal ${code.toLowerCase().replaceAll('_', ' ')}`,
    });
  }
}
