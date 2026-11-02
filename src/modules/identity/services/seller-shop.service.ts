import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ProductEntity } from '../../catalog/domain/entities/product.entity.js';
import { ShopEntity } from '../domain/shop.entity.js';
import { UserEntity } from '../domain/user.entity.js';
import {
  RegisterSellerShopDto,
  UpdateSellerShopDto,
} from '../dtos/seller-shop.dto.js';
import { RoleEntity } from '../rbac/entities/role.entity.js';
import { UserRoleEntity } from '../rbac/entities/user-role.entity.js';

export type SellerShopView = {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  headline: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  phone: string;
  email: string | null;
  warehouseAddress: string;
  status: string;
  ratingAvg: number;
  reviewCount: number;
  followerCount: number;
  reputationScore: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RegisteredSellerShop = SellerShopView & { roles: string[] };

@Injectable()
export class SellerShopService {
  constructor(private readonly dataSource: DataSource) {}

  async registerShop(
    userId: string,
    dto: RegisterSellerShopDto,
    slugRetryCount = 0,
  ): Promise<RegisteredSellerShop> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :userId', { userId })
          .andWhere('user.deleted_at IS NULL')
          .getOne();
        if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
        if (user.status !== 'ACTIVE') {
          throw new ForbiddenException(
            'Chỉ tài khoản đang hoạt động mới có thể đăng ký cửa hàng',
          );
        }

        const shops = manager.getRepository(ShopEntity);
        if (
          await shops.exists({
            where: { sellerId: userId, deletedAt: IsNull() },
          })
        ) {
          throw new ConflictException('Tài khoản đã đăng ký cửa hàng');
        }
        if (await this.shopNameExists(manager, dto.name)) {
          throw new ConflictException('Tên cửa hàng đã được sử dụng');
        }

        const shop = await shops.save(
          shops.create({
            sellerId: userId,
            name: dto.name,
            slug: await this.uniqueSlug(manager, dto.slug ?? dto.name),
            headline: dto.headline || null,
            description: dto.description || null,
            logoUrl: dto.logoUrl || null,
            bannerUrl: dto.bannerUrl || null,
            phone: dto.phone,
            email: dto.email || null,
            warehouseAddress: dto.warehouseAddress,
            identityNumber: dto.identityNumber,
            status: 'ACTIVE',
            ratingAvg: '5.00',
            reviewCount: 0,
            followerCount: 0,
            reputationScore: 50,
          }),
        );

        const sellerRole = await manager.getRepository(RoleEntity).findOne({
          where: { code: 'SELLER', deletedAt: IsNull() },
        });
        if (!sellerRole) {
          throw new InternalServerErrorException(
            'SELLER role chưa được cấu hình',
          );
        }
        await manager
          .getRepository(UserRoleEntity)
          .createQueryBuilder()
          .insert()
          .into(UserRoleEntity)
          .values({ userId, roleId: sellerRole.id })
          .orIgnore()
          .execute();
        await manager.update(
          ProductEntity,
          { sellerId: userId, shopId: IsNull() },
          { shopId: shop.id },
        );
        const roleRows = await manager.query<Array<{ code: string }>>(
          `SELECT DISTINCT role.code
             FROM identity.user_roles membership
             JOIN identity.roles role ON role.id = membership.role_id
            WHERE membership.user_id = $1 AND role.deleted_at IS NULL
            ORDER BY role.code`,
          [userId],
        );
        return {
          ...this.toView(shop),
          roles: roleRows.map(({ code }) => code),
        };
      });
    } catch (error) {
      if (slugRetryCount < 3 && this.isSlugUniqueViolation(error)) {
        return this.registerShop(userId, dto, slugRetryCount + 1);
      }
      this.rethrowDatabaseConflict(error);
    }
  }

  async getMyShop(userId: string): Promise<SellerShopView> {
    const shop = await this.dataSource.getRepository(ShopEntity).findOne({
      where: { sellerId: userId, status: 'ACTIVE', deletedAt: IsNull() },
    });
    if (!shop) throw new NotFoundException('Không tìm thấy cửa hàng');
    return this.toView(shop);
  }

  async updateMyShop(
    userId: string,
    dto: UpdateSellerShopDto,
  ): Promise<SellerShopView> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException(
        'Payload cập nhật cửa hàng không được để trống',
      );
    }
    const shops = this.dataSource.getRepository(ShopEntity);
    const shop = await shops.findOne({
      where: { sellerId: userId, status: 'ACTIVE', deletedAt: IsNull() },
    });
    if (!shop) throw new NotFoundException('Không tìm thấy cửa hàng');

    for (const field of [
      'headline',
      'description',
      'logoUrl',
      'bannerUrl',
      'phone',
      'email',
      'warehouseAddress',
    ] as const) {
      if (dto[field] !== undefined) {
        Object.assign(shop, { [field]: dto[field] });
      }
    }
    return this.toView(await shops.save(shop));
  }

  private async shopNameExists(manager: EntityManager, name: string) {
    return manager
      .getRepository(ShopEntity)
      .createQueryBuilder('shop')
      .where('lower(shop.name) = lower(:name)', { name })
      .andWhere('shop.deleted_at IS NULL')
      .getExists();
  }

  private async uniqueSlug(manager: EntityManager, input: string) {
    const base = this.slugify(input);
    let slug = base;
    let suffix = 2;
    while (
      await manager
        .getRepository(ShopEntity)
        .createQueryBuilder('shop')
        .where('lower(shop.slug) = lower(:slug)', { slug })
        .andWhere('shop.deleted_at IS NULL')
        .getExists()
    ) {
      const suffixText = `-${suffix++}`;
      slug = `${base.slice(0, 180 - suffixText.length)}${suffixText}`;
    }
    return slug;
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
        .slice(0, 180) || 'shop'
    );
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof Error && 'getStatus' in error) throw error;
    const value = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    const code = value?.code ?? value?.driverError?.code;
    if (code === '23505') {
      const constraint =
        value.constraint ?? value.driverError?.constraint ?? '';
      if (constraint.includes('name')) {
        throw new ConflictException('Tên cửa hàng đã được sử dụng');
      }
      if (constraint.includes('seller')) {
        throw new ConflictException('Tài khoản đã đăng ký cửa hàng');
      }
      throw new ConflictException('Slug cửa hàng đã được sử dụng');
    }
    throw error;
  }

  private isSlugUniqueViolation(error: unknown): boolean {
    const value = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    return (
      (value?.code ?? value?.driverError?.code) === '23505' &&
      (value?.constraint ?? value?.driverError?.constraint) ===
        'UQ_identity_shops_active_slug'
    );
  }

  private toView(shop: ShopEntity): SellerShopView {
    return {
      id: shop.id,
      sellerId: shop.sellerId,
      name: shop.name,
      slug: shop.slug,
      headline: shop.headline,
      description: shop.description,
      logoUrl: shop.logoUrl,
      bannerUrl: shop.bannerUrl,
      phone: shop.phone,
      email: shop.email,
      warehouseAddress: shop.warehouseAddress,
      status: shop.status,
      ratingAvg: Number(shop.ratingAvg),
      reviewCount: shop.reviewCount,
      followerCount: shop.followerCount,
      reputationScore: shop.reputationScore,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    };
  }
}
