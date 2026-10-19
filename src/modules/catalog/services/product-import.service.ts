import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ExternalReferenceEntity } from '../../integrations/entities/external-reference.entity.js';
import type { ImportedProduct } from '../../integrations/kaggle/contracts.js';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { ProductImageEntity } from '../domain/entities/product-image.entity.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import { ProductEntity } from '../domain/entities/product.entity.js';
import { CatalogCacheService } from './catalog-cache.service.js';

export type ProductImportOutcome = {
  action: 'created' | 'updated' | 'unchanged';
  productId: string;
  slug: string;
  oldSlug?: string;
};

@Injectable()
export class ProductImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CatalogCacheService,
  ) {}

  async inspect(
    record: ImportedProduct,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const ref = await this.dataSource.manager.findOne(ExternalReferenceEntity, {
      where: this.refKey(record, 'PRODUCT', record.externalId),
    });
    if (!ref) return 'created';
    const product = await this.dataSource.manager.findOne(ProductEntity, {
      where: { id: ref.internalId },
    });
    const category = await this.dataSource.manager.findOne(CategoryEntity, {
      where: { slug: record.categorySlug, isActive: true },
    });
    return product &&
      category &&
      (await this.aggregateMatches(
        this.dataSource.manager,
        product,
        category.id,
        record,
      ))
      ? 'unchanged'
      : 'updated';
  }

  async upsert(
    record: ImportedProduct,
    sellerId: string,
    retryRace = true,
  ): Promise<ProductImportOutcome> {
    let outcome!: ProductImportOutcome;
    try {
      await this.dataSource.transaction(async (manager) => {
        outcome = await this.upsertInTransaction(manager, record, sellerId);
      });
    } catch (error) {
      if (
        retryRace &&
        this.isUniqueViolation(error) &&
        (await this.inspect(record)) !== 'created'
      )
        return this.upsert(record, sellerId, false);
      throw error;
    }
    await this.cache.invalidateProduct(outcome.oldSlug);
    if (outcome.slug !== outcome.oldSlug)
      await this.cache.invalidateProduct(outcome.slug);
    return outcome;
  }

  private async upsertInTransaction(
    manager: EntityManager,
    record: ImportedProduct,
    sellerId: string,
  ): Promise<ProductImportOutcome> {
    const category = await manager.findOne(CategoryEntity, {
      where: { slug: record.categorySlug, isActive: true },
    });
    if (!category)
      throw new NotFoundException(
        `Không tìm thấy danh mục đã ánh xạ: ${record.categorySlug}`,
      );
    const refKey = this.refKey(record, 'PRODUCT', record.externalId);
    const ref = await manager.findOne(ExternalReferenceEntity, {
      where: refKey,
      lock: { mode: 'pessimistic_write' },
    });
    let product = ref
      ? await manager.findOne(ProductEntity, { where: { id: ref.internalId } })
      : null;
    const action: ProductImportOutcome['action'] = product
      ? (await this.aggregateMatches(manager, product, category.id, record))
        ? 'unchanged'
        : 'updated'
      : 'created';
    const oldSlug = product?.slug;
    if (!product)
      product = manager.create(ProductEntity, {
        sellerId,
        slug: await this.uniqueSlug(manager, record.name),
      });
    Object.assign(product, {
      sellerId,
      categoryId: category.id,
      name: record.name,
      description: record.description,
      brand: record.brand,
      status: 'ACTIVE',
      isAuctionEligible: record.isAuctionEligible,
      attributes: record.attributes,
    });
    product = await manager.save(product);
    if (!ref)
      await manager.save(
        manager.create(ExternalReferenceEntity, {
          ...refKey,
          internalId: product.id,
        }),
      );

    for (const input of record.skus) {
      const skuKey = this.refKey(record, 'PRODUCT_SKU', input.externalId);
      const skuRef = await manager.findOne(ExternalReferenceEntity, {
        where: skuKey,
      });
      let sku = skuRef
        ? await manager.findOne(ProductSkuEntity, {
            where: { id: skuRef.internalId },
          })
        : null;
      if (!sku)
        sku = manager.create(ProductSkuEntity, {
          productId: product.id,
          skuCode: await this.uniqueSkuCode(
            manager,
            product.slug,
            input.externalId,
          ),
        });
      Object.assign(sku, {
        productId: product.id,
        attributes: input.attributes,
        price: Number(input.price),
        currency: input.currency,
        weightGrams: input.weightGrams,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        isActive: true,
      });
      sku = await manager.save(sku);
      if (!skuRef)
        await manager.save(
          manager.create(ExternalReferenceEntity, {
            ...skuKey,
            internalId: sku.id,
          }),
        );
    }
    for (const input of record.images) {
      const imageKey = this.refKey(record, 'PRODUCT_IMAGE', input.externalId);
      const imageRef = await manager.findOne(ExternalReferenceEntity, {
        where: imageKey,
      });
      let image = imageRef
        ? await manager.findOne(ProductImageEntity, {
            where: { id: imageRef.internalId },
          })
        : null;
      if (!image)
        image = manager.create(ProductImageEntity, { productId: product.id });
      Object.assign(image, {
        productId: product.id,
        url: input.url,
        isPrimary: input.isPrimary,
        sortOrder: input.sortOrder,
      });
      image = await manager.save(image);
      if (!imageRef)
        await manager.save(
          manager.create(ExternalReferenceEntity, {
            ...imageKey,
            internalId: image.id,
          }),
        );
    }
    return {
      action,
      productId: product.id,
      slug: product.slug,
      ...(oldSlug ? { oldSlug } : {}),
    };
  }

  private refKey(
    record: ImportedProduct,
    entityType: string,
    externalId: string,
  ) {
    return {
      sourceSystem: record.sourceSystem,
      datasetName: record.datasetName,
      entityType,
      externalId,
    };
  }
  private async aggregateMatches(
    manager: EntityManager,
    product: ProductEntity,
    categoryId: string,
    record: ImportedProduct,
  ): Promise<boolean> {
    if (
      product.categoryId !== categoryId ||
      product.name !== record.name ||
      product.description !== record.description ||
      product.brand !== record.brand ||
      product.isAuctionEligible !== record.isAuctionEligible ||
      JSON.stringify(product.attributes ?? {}) !==
        JSON.stringify(record.attributes)
    )
      return false;
    if (
      (await manager.count(ProductSkuEntity, {
        where: { productId: product.id },
      })) !== record.skus.length ||
      (await manager.count(ProductImageEntity, {
        where: { productId: product.id },
      })) !== record.images.length
    )
      return false;
    for (const input of record.skus) {
      const ref = await manager.findOne(ExternalReferenceEntity, {
        where: this.refKey(record, 'PRODUCT_SKU', input.externalId),
      });
      const sku = ref
        ? await manager.findOne(ProductSkuEntity, {
            where: { id: ref.internalId },
          })
        : null;
      if (
        !sku ||
        sku.productId !== product.id ||
        Number(sku.price) !== Number(input.price) ||
        sku.currency !== input.currency ||
        JSON.stringify(sku.attributes) !== JSON.stringify(input.attributes) ||
        sku.weightGrams !== input.weightGrams ||
        Number(sku.lengthCm) !== input.lengthCm ||
        Number(sku.widthCm) !== input.widthCm ||
        Number(sku.heightCm) !== input.heightCm ||
        !sku.isActive
      )
        return false;
    }
    for (const input of record.images) {
      const ref = await manager.findOne(ExternalReferenceEntity, {
        where: this.refKey(record, 'PRODUCT_IMAGE', input.externalId),
      });
      const image = ref
        ? await manager.findOne(ProductImageEntity, {
            where: { id: ref.internalId },
          })
        : null;
      if (
        !image ||
        image.productId !== product.id ||
        image.url !== input.url ||
        image.isPrimary !== input.isPrimary ||
        image.sortOrder !== input.sortOrder
      )
        return false;
    }
    return true;
  }
  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: string; driverError?: { code?: string } };
    return value.code === '23505' || value.driverError?.code === '23505';
  }
  private slugify(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180) || 'product'
    );
  }
  private async uniqueSlug(
    manager: EntityManager,
    name: string,
  ): Promise<string> {
    const base = this.slugify(name);
    let value = base;
    let i = 2;
    while (await manager.exists(ProductEntity, { where: { slug: value } }))
      value = `${base}-${i++}`;
    return value;
  }
  private async uniqueSkuCode(
    manager: EntityManager,
    slug: string,
    externalId: string,
  ): Promise<string> {
    const suffix = this.slugify(externalId).toUpperCase().slice(-40);
    const base = `${slug}-${suffix}`.toUpperCase();
    let value = base;
    let i = 2;
    while (
      await manager.exists(ProductSkuEntity, { where: { skuCode: value } })
    )
      value = `${base}-${i++}`;
    return value;
  }
}
