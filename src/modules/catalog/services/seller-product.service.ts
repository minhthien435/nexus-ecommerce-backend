import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { IdentityPublicApi } from '../../identity/identity-public.api.js';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { ProductImageEntity } from '../domain/entities/product-image.entity.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import {
  ProductEntity,
  ProductStatus,
} from '../domain/entities/product.entity.js';
import {
  CreateSellerProductDto,
  SellerProductImageDto,
  SellerProductQueryDto,
  UpdateSellerProductDto,
} from '../dtos/seller-product.dto.js';
import { CatalogCacheService } from './catalog-cache.service.js';
import { ProductSkuService } from './product-sku.service.js';
import { ShopEntity } from '../../identity/domain/shop.entity.js';

@Injectable()
export class SellerProductService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly skuService: ProductSkuService,
    private readonly identityApi: IdentityPublicApi,
    private readonly cache: CatalogCacheService,
  ) {}

  async list(actorId: string, query: SellerProductQueryDto) {
    const isAdmin = await this.isAdmin(actorId);
    const qb = this.dataSource
      .getRepository(ProductEntity)
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.skus', 'skus')
      .where('product.deleted_at IS NULL');
    if (!isAdmin) qb.andWhere('product.seller_id = :actorId', { actorId });
    if (query.status)
      qb.andWhere('product.status = :status', { status: query.status });
    if (query.search?.trim()) {
      qb.andWhere(
        '(product.name ILIKE :search OR product.slug ILIKE :search)',
        {
          search: `%${query.search.trim()}%`,
        },
      );
    }
    const [items, total] = await qb
      .orderBy('product.created_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actorId: string): Promise<ProductEntity> {
    return this.getOwned(this.dataSource.manager, id, actorId);
  }

  async create(
    dto: CreateSellerProductDto,
    actorId: string,
    slugRetryCount = 0,
  ): Promise<ProductEntity> {
    this.assertImages(dto.images);
    this.assertSkuInputs(dto.skus);
    let productId = '';
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.assertLeafCategory(manager, dto.categoryId);
        const shop = await manager.getRepository(ShopEntity).findOne({
          where: {
            sellerId: actorId,
            status: 'ACTIVE',
            deletedAt: IsNull(),
          },
          select: { id: true },
        });
        let product = manager.create(ProductEntity, {
          sellerId: actorId,
          shopId: shop?.id ?? null,
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          slug: await this.uniqueSlug(manager, dto.name),
          description: dto.description?.trim() || null,
          brand: dto.brand?.trim() || null,
          status: ProductStatus.DRAFT,
          isAuctionEligible: dto.isAuctionEligible ?? true,
          attributes: dto.attributes ?? null,
        });
        product = await manager.save(product);
        productId = product.id;
        await manager.save(
          dto.images.map((image) =>
            manager.create(ProductImageEntity, { ...image, productId }),
          ),
        );
        for (const input of dto.skus) {
          const attributes = this.skuService.normalizeAttributes(
            input.attributes,
          );
          const base = this.skuService.generateSkuCode(
            product.slug,
            attributes,
          );
          const skuCode = await this.uniqueSkuCode(manager, base);
          await manager.save(
            manager.create(ProductSkuEntity, {
              productId,
              skuCode,
              attributes,
              price: input.price,
              originalPrice: input.originalPrice ?? null,
              currency: (input.currency ?? 'VND').trim().toUpperCase(),
              weightGrams: input.weightGrams,
              lengthCm: input.lengthCm,
              widthCm: input.widthCm,
              heightCm: input.heightCm,
              isActive: input.isActive ?? true,
            }),
          );
        }
      });
    } catch (error) {
      if (slugRetryCount < 3 && this.isSlugUniqueViolation(error)) {
        return this.create(dto, actorId, slugRetryCount + 1);
      }
      throw error;
    }
    const product = await this.get(productId, actorId);
    await this.cache.invalidateProduct(product.slug);
    return product;
  }

  async update(
    id: string,
    dto: UpdateSellerProductDto,
    actorId: string,
  ): Promise<ProductEntity> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException(
        'Payload cập nhật sản phẩm không được để trống',
      );
    }
    if (dto.images) this.assertImages(dto.images);
    let slug = '';
    await this.dataSource.transaction(async (manager) => {
      const product = await this.getOwned(manager, id, actorId, false);
      slug = product.slug;
      if (dto.categoryId !== undefined) {
        await this.assertLeafCategory(manager, dto.categoryId);
        product.categoryId = dto.categoryId;
      }
      if (dto.name !== undefined) product.name = dto.name.trim();
      if (dto.description !== undefined)
        product.description = dto.description?.trim() || null;
      if (dto.brand !== undefined) product.brand = dto.brand?.trim() || null;
      if (dto.isAuctionEligible !== undefined)
        product.isAuctionEligible = dto.isAuctionEligible;
      if (dto.attributes !== undefined) product.attributes = dto.attributes;
      await manager.save(product);
      if (dto.images) {
        await manager.delete(ProductImageEntity, { productId: id });
        await manager.save(
          dto.images.map((image) =>
            manager.create(ProductImageEntity, { ...image, productId: id }),
          ),
        );
      }
    });
    await this.cache.invalidateProduct(slug);
    return this.get(id, actorId);
  }

  async setStatus(
    id: string,
    status: ProductStatus,
    actorId: string,
  ): Promise<ProductEntity> {
    let slug = '';
    await this.dataSource.transaction(async (manager) => {
      const product = await this.getOwned(manager, id, actorId);
      slug = product.slug;
      if (status === ProductStatus.ACTIVE) {
        await this.assertLeafCategory(manager, product.categoryId);
        if (!product.images?.some((image) => image.isPrimary)) {
          throw new BadRequestException(
            'Sản phẩm phải có ảnh chính trước khi kích hoạt',
          );
        }
        if (!product.skus?.some((sku) => sku.isActive)) {
          throw new BadRequestException(
            'Sản phẩm phải có SKU đang hoạt động trước khi kích hoạt',
          );
        }
      }
      product.status = status;
      await manager.save(product);
    });
    await this.cache.invalidateProduct(slug);
    return this.get(id, actorId);
  }

  async remove(id: string, actorId: string): Promise<void> {
    let slug = '';
    await this.dataSource.transaction(async (manager) => {
      const product = await this.getOwned(manager, id, actorId, false);
      slug = product.slug;
      await manager.update(
        ProductSkuEntity,
        { productId: id, isActive: true },
        { isActive: false },
      );
      await manager.softRemove(product);
    });
    await this.cache.invalidateProduct(slug);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private async getOwned(
    manager: EntityManager,
    idOrSlug: string,
    actorId: string,
    relations = true,
  ) {
    const isUuid = this.isUuid(idOrSlug);
    const product = await manager.findOne(ProductEntity, {
      where: isUuid
        ? { id: idOrSlug, deletedAt: IsNull() }
        : { slug: idOrSlug, deletedAt: IsNull() },
      relations: relations
        ? { category: true, images: true, skus: true }
        : undefined,
    });
    if (
      !product ||
      (!(await this.isAdmin(actorId)) && product.sellerId !== actorId)
    ) {
      throw new NotFoundException(
        `Không tìm thấy sản phẩm với ID: ${idOrSlug}`,
      );
    }
    return product;
  }

  private async isAdmin(actorId: string): Promise<boolean> {
    return (await this.identityApi.getUserRoles(actorId)).includes('ADMIN');
  }

  private async assertLeafCategory(manager: EntityManager, categoryId: string) {
    const category = await manager.findOne(CategoryEntity, {
      where: { id: categoryId, isActive: true, deletedAt: IsNull() },
    });
    const childCount = category
      ? await manager.count(CategoryEntity, {
          where: { parentId: categoryId, deletedAt: IsNull() },
        })
      : 0;
    if (!category || childCount > 0) {
      throw new BadRequestException(
        'Danh mục phải là danh mục lá đang hoạt động',
      );
    }
  }

  private assertImages(images: SellerProductImageDto[]) {
    if (images.filter((image) => image.isPrimary).length !== 1) {
      throw new BadRequestException('Sản phẩm phải có đúng một ảnh chính');
    }
    const orders = new Set(images.map((image) => image.sortOrder));
    if (orders.size !== images.length)
      throw new BadRequestException('Thứ tự ảnh không được trùng');
  }

  private assertSkuInputs(skus: CreateSellerProductDto['skus']) {
    const variants = new Set<string>();
    for (const sku of skus) {
      if (sku.originalPrice !== undefined && sku.originalPrice < sku.price) {
        throw new BadRequestException('Giá gốc phải lớn hơn hoặc bằng giá bán');
      }
      const key = JSON.stringify(
        this.skuService.normalizeAttributes(sku.attributes),
      );
      if (variants.has(key))
        throw new ConflictException('Tổ hợp thuộc tính biến thể bị trùng');
      variants.add(key);
    }
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

  private async uniqueSlug(manager: EntityManager, name: string) {
    const base = this.slugify(name);
    let value = base;
    let suffix = 2;
    while (
      await manager.exists(ProductEntity, {
        where: { slug: value },
        withDeleted: true,
      })
    )
      value = `${base}-${suffix++}`;
    return value;
  }

  private isSlugUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as {
      code?: string;
      constraint?: string;
      detail?: string;
      driverError?: { code?: string; constraint?: string; detail?: string };
    };
    const code = value.code ?? value.driverError?.code;
    const context = `${value.constraint ?? value.driverError?.constraint ?? ''} ${value.detail ?? value.driverError?.detail ?? ''}`;
    return (
      code === '23505' &&
      /products.*slug|slug.*products|key \("?slug"?\)/i.test(context)
    );
  }

  private async uniqueSkuCode(manager: EntityManager, base: string) {
    let value = base;
    let suffix = 2;
    while (
      await manager.exists(ProductSkuEntity, { where: { skuCode: value } })
    )
      value = `${base}-${suffix++}`;
    return value;
  }
}
