import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Raw, Repository } from 'typeorm';
import { IdentityPublicApi } from '../../identity/identity-public.api.js';
import { ProductSkuEntity } from '../domain/entities/product-sku.entity.js';
import { ProductEntity } from '../domain/entities/product.entity.js';
import { CreateSkuDto } from '../dtos/create-sku.dto.js';
import { isValidSkuAttributes } from '../dtos/sku-attributes.validator.js';
import { UpdateSkuDto } from '../dtos/update-sku.dto.js';
import { InventoryAvailabilityPort } from '../ports/inventory-availability.port.js';

const ATTRIBUTE_PRIORITY = [
  'storage',
  'size',
  'color',
  'configuration',
] as const;

@Injectable()
export class ProductSkuService {
  constructor(
    @InjectRepository(ProductSkuEntity)
    private readonly skuRepo: Repository<ProductSkuEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
    private readonly identityApi: IdentityPublicApi,
    private readonly inventoryAvailability: InventoryAvailabilityPort,
    private readonly config: ConfigService,
  ) {}

  normalizeAttributes(
    attributes: Record<string, string>,
  ): Record<string, string> {
    if (!isValidSkuAttributes(attributes)) {
      throw new BadRequestException(
        'Thuộc tính biến thể phải là object không rỗng với key/value là chuỗi không rỗng',
      );
    }

    const normalized = new Map<string, string>();
    for (const [rawKey, rawValue] of Object.entries(attributes)) {
      const key = rawKey.trim().toLowerCase();
      if (normalized.has(key)) {
        throw new BadRequestException(
          `Thuộc tính biến thể bị trùng sau khi chuẩn hóa: ${key}`,
        );
      }
      normalized.set(key, rawValue.trim());
    }

    return Object.fromEntries(
      [...normalized.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  generateSkuCode(
    productSlug: string,
    attributes: Record<string, string>,
  ): string {
    const normalized = this.normalizeAttributes(attributes);
    const keys = Object.keys(normalized).sort((left, right) => {
      const leftPriority = ATTRIBUTE_PRIORITY.indexOf(
        left as (typeof ATTRIBUTE_PRIORITY)[number],
      );
      const rightPriority = ATTRIBUTE_PRIORITY.indexOf(
        right as (typeof ATTRIBUTE_PRIORITY)[number],
      );
      if (leftPriority !== -1 || rightPriority !== -1) {
        if (leftPriority === -1) return 1;
        if (rightPriority === -1) return -1;
        return leftPriority - rightPriority;
      }
      return left.localeCompare(right);
    });

    return [productSlug, ...keys.map((key) => normalized[key])]
      .map((part) => this.toSkuPart(part))
      .filter(Boolean)
      .join('-');
  }

  async create(
    productId: string,
    dto: CreateSkuDto,
    actorId: string,
  ): Promise<ProductSkuEntity> {
    const product = await this.getManagedProduct(productId, actorId);
    const attributes = this.normalizeAttributes(dto.attributes);
    await this.assertAttributesUnique(productId, attributes);

    const baseCode = this.generateSkuCode(product.slug, attributes);
    let skuCode = baseCode;
    let suffix = 2;
    while (await this.skuRepo.findOne({ where: { skuCode } })) {
      skuCode = `${baseCode}-${suffix++}`;
    }

    const sku = this.skuRepo.create({
      productId,
      skuCode,
      attributes,
      price: dto.price,
      currency: (dto.currency ?? 'VND').trim().toUpperCase(),
      weightGrams: dto.weightGrams,
      lengthCm: dto.lengthCm,
      widthCm: dto.widthCm,
      heightCm: dto.heightCm,
      isActive: dto.isActive ?? true,
    });

    try {
      return await this.skuRepo.save(sku);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Mã SKU hoặc tổ hợp thuộc tính biến thể đã tồn tại',
        );
      }
      throw error;
    }
  }

  async listByProduct(
    productId: string,
    actorId: string,
  ): Promise<ProductSkuEntity[]> {
    await this.getManagedProduct(productId, actorId);
    return this.skuRepo.find({
      where: { productId },
      order: { createdAt: 'ASC' },
    });
  }

  async getById(id: string, actorId: string): Promise<ProductSkuEntity> {
    const sku = await this.findSku(id);
    await this.getManagedProduct(sku.productId, actorId);
    return sku;
  }

  async update(
    id: string,
    dto: UpdateSkuDto,
    actorId: string,
  ): Promise<ProductSkuEntity> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Payload cập nhật SKU không được để trống');
    }

    const sku = await this.findSku(id);
    await this.getManagedProduct(sku.productId, actorId);

    if (dto.attributes !== undefined) {
      const attributes = this.normalizeAttributes(dto.attributes);
      await this.assertAttributesUnique(sku.productId, attributes, sku.id);
      sku.attributes = attributes;
    }
    if (dto.price !== undefined) sku.price = dto.price;
    if (dto.currency !== undefined) {
      sku.currency = dto.currency.trim().toUpperCase();
    }
    if (dto.weightGrams !== undefined) sku.weightGrams = dto.weightGrams;
    if (dto.lengthCm !== undefined) sku.lengthCm = dto.lengthCm;
    if (dto.widthCm !== undefined) sku.widthCm = dto.widthCm;
    if (dto.heightCm !== undefined) sku.heightCm = dto.heightCm;
    if (dto.isActive !== undefined) sku.isActive = dto.isActive;

    try {
      return await this.skuRepo.save(sku);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Mã SKU hoặc tổ hợp thuộc tính biến thể đã tồn tại',
        );
      }
      throw error;
    }
  }

  async deactivate(id: string, actorId: string): Promise<ProductSkuEntity> {
    const sku = await this.findSku(id);
    await this.getManagedProduct(sku.productId, actorId);
    sku.isActive = false;
    return this.skuRepo.save(sku);
  }

  async checkAvailableStock(skuId: string, quantity: number): Promise<boolean> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Số lượng phải là số nguyên dương');
    }

    const sku = await this.skuRepo.findOne({
      where: { id: skuId, isActive: true },
    });
    if (!sku) return false;

    try {
      const available =
        await this.inventoryAvailability.getAvailableQuantity(skuId);
      if (available === null || !Number.isInteger(available) || available < 0) {
        return false;
      }
      if (available >= quantity) return true;
      return this.isOversellAllowed();
    } catch {
      return false;
    }
  }

  private async findSku(id: string): Promise<ProductSkuEntity> {
    const sku = await this.skuRepo.findOne({ where: { id } });
    if (!sku) throw new NotFoundException(`Không tìm thấy SKU với ID: ${id}`);
    return sku;
  }

  private async getManagedProduct(
    productId: string,
    actorId: string,
  ): Promise<ProductEntity> {
    const product = await this.productRepo.findOne({
      where: { id: productId, deletedAt: IsNull() },
    });
    if (!product) {
      throw new NotFoundException(
        `Không tìm thấy sản phẩm với ID: ${productId}`,
      );
    }

    const roles = await this.identityApi.getUserRoles(actorId);
    if (
      !roles.includes('ADMIN') &&
      (!roles.includes('SELLER') || product.sellerId !== actorId)
    ) {
      throw new ForbiddenException('Bạn không có quyền quản lý sản phẩm này');
    }
    return product;
  }

  private async assertAttributesUnique(
    productId: string,
    attributes: Record<string, string>,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.skuRepo.findOne({
      where: {
        productId,
        attributes: Raw((alias) => `${alias} = :attributes::jsonb`, {
          attributes: JSON.stringify(attributes),
        }),
      },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        'Tổ hợp thuộc tính biến thể đã tồn tại cho sản phẩm này',
      );
    }
  }

  private toSkuPart(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  }

  private isOversellAllowed(): boolean {
    return ['1', 'true', 'yes'].includes(
      this.config.get<string>('ALLOW_OVERSELL', 'false').toLowerCase(),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    return (
      candidate.code === '23505' || candidate.driverError?.code === '23505'
    );
  }
}
