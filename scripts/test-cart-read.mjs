import 'dotenv/config';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { ProductEntity } from '../dist/modules/catalog/domain/entities/product.entity.js';
import { CatalogCartService } from '../dist/modules/catalog/services/catalog-cart.service.js';
import { InventoryReadService } from '../dist/modules/fulfillment/services/inventory-read.service.js';
import { WarehouseEntity } from '../dist/modules/fulfillment/domain/entities/warehouse.entity.js';
import { InventoryItemEntity } from '../dist/modules/fulfillment/domain/entities/inventory-item.entity.js';
import { CartService } from '../dist/modules/commerce/services/cart.service.js';

// Execute production SELECTs with typed CTE fixtures. No tables or persistent
// records are created, even temporarily; READ ONLY is enforced by PostgreSQL.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const products = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: id(n),
  seller_id: id(701),
  name: `Product ${n}`,
  slug: `product-${n}`,
  status: n === 4 ? 'DRAFT' : 'ACTIVE',
  deleted_at: n === 5 ? '2026-01-01T00:00:00Z' : null,
}));
const skus = products.map((product, index) => ({
  id: id(101 + index),
  product_id: product.id,
  sku_code: `SKU-${index}`,
  variant_attributes: { color: 'blue' },
  price: index === 0 ? '0.20' : '0.10',
  currency: 'VND',
  is_active: index !== 5,
}));
const warehouses = [
  { id: id(201), is_default: true, is_active: true },
  { id: id(202), is_default: false, is_active: true },
];
const inventoryRows = [
  { id: id(301), warehouse_id: id(201), sku_id: id(101), available_qty: 3 },
  { id: id(302), warehouse_id: id(201), sku_id: id(102), available_qty: 1 },
  // Stock elsewhere must not qualify SKU 102 or 103 at the default warehouse.
  { id: id(303), warehouse_id: id(202), sku_id: id(102), available_qty: 1000 },
  { id: id(304), warehouse_id: id(202), sku_id: id(103), available_qty: 1000 },
];

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
  abortOnError: false,
});
const source = app.get(DataSource);
const runner = source.createQueryRunner();
try {
  await runner.connect();
  await runner.startTransaction();
  await runner.query('SET TRANSACTION READ ONLY');
  assert.equal(
    (await runner.query('SHOW transaction_read_only'))[0].transaction_read_only,
    'on',
  );

  const repository = source.getRepository(ProductEntity);
  const catalog = new CatalogCartService({
    createQueryBuilder: (alias) => {
      const builder = repository.createQueryBuilder(alias);
      builder.getRawMany = async () => {
        const [sql, params] = builder.getQueryAndParameters();
        assert.ok(sql.includes('"catalog"."products"'));
        assert.ok(sql.includes('"catalog"."product_skus"'));
        const ctes = `WITH fixture_products AS (
          SELECT * FROM jsonb_to_recordset($${params.length + 1}::jsonb)
          AS p(id uuid, seller_id uuid, name varchar, slug varchar, status varchar, deleted_at timestamptz)
        ), fixture_skus AS (
          SELECT * FROM jsonb_to_recordset($${params.length + 2}::jsonb)
          AS s(id uuid, product_id uuid, sku_code varchar, variant_attributes jsonb,
               price numeric(18,2), currency char(3), is_active boolean)
        ) `;
        return runner.query(
          ctes +
            sql
              .replaceAll('"catalog"."products"', 'fixture_products')
              .replaceAll('"catalog"."product_skus"', 'fixture_skus'),
          [...params, JSON.stringify(products), JSON.stringify(skus)],
        );
      };
      return builder;
    },
  });

  let warehouseFixture = warehouses;
  // The real repositories also verify the mapped columns against the actual
  // schema, within this READ ONLY transaction and without assuming row content.
  await runner.manager.getRepository(WarehouseEntity).find({ take: 1 });
  await runner.manager.getRepository(InventoryItemEntity).find({ take: 1 });
  const fixtureRepository = (entity) => ({
    find: async (options) => {
      const repository = source.getRepository(entity);
      const builder = repository
        .createQueryBuilder('fixture')
        .setFindOptions(options);
      const [sql, params] = builder.getQueryAndParameters();
      const ctes = `WITH fixture_warehouses AS (
        SELECT * FROM jsonb_to_recordset($${params.length + 1}::jsonb)
        AS w(id uuid, is_default boolean, is_active boolean)
      ), fixture_inventory AS (
        SELECT * FROM jsonb_to_recordset($${params.length + 2}::jsonb)
        AS i(id uuid, warehouse_id uuid, sku_id uuid, available_qty integer)
      ) `;
      const rows = await runner.query(
        ctes +
          sql
            .replaceAll('"fulfillment"."warehouses"', 'fixture_warehouses')
            .replaceAll('"fulfillment"."inventory_items"', 'fixture_inventory'),
        [
          ...params,
          JSON.stringify(warehouseFixture),
          JSON.stringify(inventoryRows),
        ],
      );
      // Hydrate generated projection aliases back to entity properties.
      return rows.map((row) =>
        Object.fromEntries(
          repository.metadata.columns
            .filter((column) =>
              Object.hasOwn(row, `fixture_${column.databaseName}`),
            )
            .map((column) => [
              column.propertyName,
              row[`fixture_${column.databaseName}`],
            ]),
        ),
      );
    },
  });
  const inventory = new InventoryReadService(
    fixtureRepository(WarehouseEntity),
    fixtureRepository(InventoryItemEntity),
  );

  const projected = await catalog.getCartSkus([
    id(101),
    id(104),
    id(105),
    id(106),
  ]);
  const active = projected.find((sku) => sku.id === id(101));
  assert.equal(active.productId, id(1));
  assert.equal(active.productStatus, 'ACTIVE');
  assert.equal(active.productDeletedAt, null);
  assert.equal(active.currency, 'VND');
  assert.equal(active.price, '0.20');
  assert.deepEqual(active.variantAttributes, { color: 'blue' });
  assert.equal(
    projected.find((sku) => sku.id === id(104)).productStatus,
    'DRAFT',
  );
  assert.ok(
    projected.find((sku) => sku.id === id(105)).productDeletedAt instanceof
      Date,
  );
  assert.equal(projected.find((sku) => sku.id === id(106)).isActive, false);

  const stock = await inventory.getDefaultWarehouseStock([
    id(101),
    id(102),
    id(103),
  ]);
  assert.deepEqual(
    new Map(stock.map((row) => [row.skuId, row.availableQuantity])),
    new Map([
      [id(101), 3],
      [id(102), 1],
      [id(103), 0],
    ]),
  );

  const cartRows = skus.map((sku, index) => ({
    id: id(401 + index),
    skuId: sku.id,
    productId: sku.product_id,
    quantity: index === 0 ? 3 : 2,
    unitPriceSnapshot: '0.10',
    productNameSnapshot: 'Snapshot',
  }));
  const cart = new CartService(
    {
      query: (...args) => runner.query(...args),
      findOne: async ({ where }) =>
        where.userId === id(501) && where.status === 'ACTIVE'
          ? { id: id(601), expiresAt: new Date('2100-01-01T00:00:00Z') }
          : null,
    },
    { find: async () => cartRows },
    catalog,
    inventory,
  );
  const result = await cart.getCart(id(501));
  assert.equal(result.subtotal, '0.60');
  assert.equal(result.items[0].lineTotal, '0.60');
  assert.equal(result.items[0].priceChanged, true);
  assert.equal(result.excludedItemCount, 5);
  assert.deepEqual(
    result.items.map((item) => item.exclusionReason),
    [
      null,
      'INSUFFICIENT_STOCK',
      'OUT_OF_STOCK',
      'DISCONTINUED',
      'DISCONTINUED',
      'DISCONTINUED',
    ],
  );
  assert.equal((await cart.getCart(id(502))).subtotal, '0.00');
  assert.ok(cartRows.every((row) => row.unitPriceSnapshot === '0.10'));

  for (const fixture of [
    [],
    [{ ...warehouses[0], is_active: false }],
    [warehouses[0], { ...warehouses[1], is_default: true }],
  ]) {
    warehouseFixture = fixture;
    await assert.rejects(
      () => inventory.getDefaultWarehouseStock([id(101)]),
      (error) =>
        error.getStatus() === 503 &&
        error.getResponse().errorCode === 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
    );
  }
  console.log(
    'PASS: real module graph, read-only PostgreSQL CTE projections, multi-SKU stock, cart totals and exclusions, warehouse selection errors',
  );
  console.log(
    'Shared application rows were not inserted, updated or deleted. Fixtures existed only within SELECT statements.',
  );
} finally {
  if (runner.isTransactionActive) await runner.rollbackTransaction();
  await runner.release();
  await app.close();
}
