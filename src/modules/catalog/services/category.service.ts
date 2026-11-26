import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { ProductEntity } from '../domain/entities/product.entity.js';
import { CategoryTreeNode } from '../dtos/category-response.dto.js';
import { CreateCategoryDto } from '../dtos/create-category.dto.js';
import { UpdateCategoryDto } from '../dtos/update-category.dto.js';

interface CacheEntry {
  data: CategoryTreeNode[];
  expiresAt: number;
}

@Injectable()
export class CategoryService {
  private treeCache: CacheEntry | null = null;
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút

  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepo: Repository<ProductEntity>,
  ) {}

  /**
   * Chuyển đổi tên tiếng Việt / chuỗi bất kỳ thành slug chuẩn SEO
   */
  public generateSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  /**
   * Xóa bộ nhớ đệm cây danh mục
   */
  public clearCache(): void {
    this.treeCache = null;
  }

  private normalizeNameVi(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Lấy toàn bộ cây danh mục đa cấp (tối đa 3 cấp) lồng nhau
   */
  async getCategoryTree(includeInactive = false): Promise<CategoryTreeNode[]> {
    if (
      !includeInactive &&
      this.treeCache &&
      this.treeCache.expiresAt > Date.now()
    ) {
      return this.treeCache.data;
    }

    const queryBuilder = this.categoryRepo
      .createQueryBuilder('category')
      .where('category.deletedAt IS NULL')
      .orderBy('category.level', 'ASC')
      .addOrderBy('category.sortOrder', 'ASC')
      .addOrderBy('category.name', 'ASC');

    if (!includeInactive) {
      queryBuilder.andWhere('category.isActive = :isActive', {
        isActive: true,
      });
    }

    const categories = await queryBuilder.getMany();

    const nodeMap = new Map<string, CategoryTreeNode>();
    const tree: CategoryTreeNode[] = [];

    // Khởi tạo các node
    for (const cat of categories) {
      nodeMap.set(cat.id, {
        id: cat.id,
        name: cat.name,
        nameVi: cat.nameVi ?? null,
        slug: cat.slug,
        level: cat.level,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
        parentId: cat.parentId,
        children: [],
      });
    }

    // Ghép cây phân cấp
    for (const cat of categories) {
      const node = nodeMap.get(cat.id)!;
      if (cat.parentId && nodeMap.has(cat.parentId)) {
        const parentNode = nodeMap.get(cat.parentId)!;
        parentNode.children.push(node);
      } else {
        tree.push(node);
      }
    }

    if (!includeInactive) {
      this.treeCache = {
        data: tree,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      };
    }

    return tree;
  }

  /**
   * Lấy chi tiết danh mục theo ID
   */
  async getById(id: string): Promise<CategoryEntity> {
    const category = await this.categoryRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { parent: true, children: true },
    });

    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục với ID: ${id}`);
    }

    return category;
  }

  /**
   * Lấy chi tiết danh mục theo Slug
   */
  async getBySlug(slug: string): Promise<CategoryEntity> {
    const category = await this.categoryRepo.findOne({
      where: { slug, deletedAt: IsNull() },
      relations: { parent: true, children: true },
    });

    if (!category) {
      throw new NotFoundException(`Không tìm thấy danh mục với slug: ${slug}`);
    }

    return category;
  }

  /**
   * Tạo mới danh mục (khống chế độ sâu tối đa 3 cấp)
   */
  async createCategory(dto: CreateCategoryDto): Promise<CategoryEntity> {
    let level = 1;
    let parent: CategoryEntity | null = null;

    if (dto.parentId) {
      parent = await this.categoryRepo.findOne({
        where: { id: dto.parentId, deletedAt: IsNull() },
      });

      if (!parent) {
        throw new NotFoundException('Danh mục cha không tồn tại');
      }

      level = parent.level + 1;
      if (level > 3) {
        throw new BadRequestException(
          'Danh mục chỉ được phân cấp tối đa 3 cấp',
        );
      }
    }

    const baseSlug = dto.slug
      ? this.generateSlug(dto.slug)
      : this.generateSlug(dto.name);

    let uniqueSlug = baseSlug;
    let counter = 1;
    while (
      await this.categoryRepo.findOne({
        where: { slug: uniqueSlug, deletedAt: IsNull() },
      })
    ) {
      uniqueSlug = `${baseSlug}-${counter++}`;
    }

    const category = this.categoryRepo.create({
      name: dto.name.trim(),
      nameVi: this.normalizeNameVi(dto.nameVi),
      slug: uniqueSlug,
      parentId: dto.parentId ?? null,
      level,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    const saved = await this.categoryRepo.save(category);
    this.clearCache();
    return saved;
  }

  /**
   * Cập nhật thông tin danh mục
   */
  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryEntity> {
    const category = await this.getById(id);

    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Danh mục cha không thể là chính nó');
      }

      if (dto.parentId) {
        const newParent = await this.categoryRepo.findOne({
          where: { id: dto.parentId, deletedAt: IsNull() },
        });

        if (!newParent) {
          throw new NotFoundException('Danh mục cha không tồn tại');
        }

        // Kiểm tra không được chọn con cháu làm cha (chống cycle)
        const isDescendant = await this.isDescendantOf(newParent.id, id);
        if (isDescendant) {
          throw new BadRequestException(
            'Không thể chọn danh mục con/cháu làm danh mục cha',
          );
        }

        const newLevel = newParent.level + 1;
        const maxSubDepth = await this.getMaxSubDepth(id);
        if (newLevel + maxSubDepth > 3) {
          throw new BadRequestException(
            'Không thể di chuyển danh mục vì sẽ làm cây con vượt quá 3 cấp',
          );
        }

        category.parentId = newParent.id;
        category.level = newLevel;
        await this.updateSubLevels(id, newLevel);
      } else {
        category.parentId = null;
        category.level = 1;
        await this.updateSubLevels(id, 1);
      }
    }

    if (dto.name !== undefined) {
      category.name = dto.name.trim();
    }

    if (dto.nameVi !== undefined) {
      category.nameVi = this.normalizeNameVi(dto.nameVi);
    }

    if (dto.slug !== undefined) {
      const targetSlug = this.generateSlug(dto.slug);
      if (targetSlug !== category.slug) {
        const existing = await this.categoryRepo.findOne({
          where: { slug: targetSlug, deletedAt: IsNull() },
        });
        if (existing && existing.id !== id) {
          throw new ConflictException(`Slug "${targetSlug}" đã được sử dụng`);
        }
        category.slug = targetSlug;
      }
    }

    if (dto.sortOrder !== undefined) {
      category.sortOrder = dto.sortOrder;
    }

    if (dto.isActive !== undefined) {
      category.isActive = dto.isActive;
    }

    const saved = await this.categoryRepo.save(category);
    this.clearCache();
    return saved;
  }

  /**
   * Xóa mềm danh mục (kiểm tra toàn vẹn sản phẩm & danh mục con)
   */
  async deleteCategory(
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    const category = await this.getById(id);

    // AC-2: Kiểm tra xem có sản phẩm nào thuộc danh mục này không
    const productCount = await this.productRepo.count({
      where: { categoryId: id, deletedAt: IsNull() },
    });

    if (productCount > 0) {
      throw new ConflictException(
        `Không thể xóa danh mục đang chứa ${productCount} sản phẩm`,
      );
    }

    // Kiểm tra danh mục con
    const childrenCount = await this.categoryRepo.count({
      where: { parentId: id, deletedAt: IsNull() },
    });

    if (childrenCount > 0) {
      throw new ConflictException(
        `Không thể xóa danh mục đang có ${childrenCount} danh mục con`,
      );
    }

    await this.categoryRepo.softDelete(category.id);
    this.clearCache();

    return {
      success: true,
      message: 'Xóa danh mục thành công',
    };
  }

  /**
   * Kiểm tra targetId có phải là hậu duệ của ancestorId hay không
   */
  private async isDescendantOf(
    targetId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let current = await this.categoryRepo.findOne({
      where: { id: targetId, deletedAt: IsNull() },
    });

    while (current && current.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }
      current = await this.categoryRepo.findOne({
        where: { id: current.parentId, deletedAt: IsNull() },
      });
    }

    return false;
  }

  /**
   * Tính độ sâu lớn nhất của các nhánh con tính từ categoryId (0 nếu không có con)
   */
  private async getMaxSubDepth(
    categoryId: string,
    currentRelativeDepth = 0,
  ): Promise<number> {
    const children = await this.categoryRepo.find({
      where: { parentId: categoryId, deletedAt: IsNull() },
    });

    if (children.length === 0) {
      return currentRelativeDepth;
    }

    let maxDepth = currentRelativeDepth + 1;
    for (const child of children) {
      const childMax = await this.getMaxSubDepth(
        child.id,
        currentRelativeDepth + 1,
      );
      if (childMax > maxDepth) {
        maxDepth = childMax;
      }
    }

    return maxDepth;
  }

  /**
   * Cập nhật level cho toàn bộ cây con sau khi thay đổi parent
   */
  private async updateSubLevels(
    parentId: string,
    parentLevel: number,
  ): Promise<void> {
    const children = await this.categoryRepo.find({
      where: { parentId, deletedAt: IsNull() },
    });

    for (const child of children) {
      child.level = parentLevel + 1;
      await this.categoryRepo.save(child);
      await this.updateSubLevels(child.id, child.level);
    }
  }
}
