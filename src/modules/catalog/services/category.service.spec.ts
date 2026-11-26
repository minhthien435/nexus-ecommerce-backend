import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryEntity } from '../domain/entities/category.entity.js';
import { CategoryService } from './category.service.js';

describe('CategoryService', () => {
  let service: CategoryService;
  let categoryRepo: any;
  let productRepo: any;

  beforeEach(() => {
    categoryRepo = {
      createQueryBuilder: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn((dto) => ({ ...dto, id: 'cat-new-id' })),
      save: vi.fn((cat) => Promise.resolve({ ...cat })),
      count: vi.fn(),
      softDelete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    productRepo = {
      count: vi.fn().mockResolvedValue(0),
    };

    service = new CategoryService(categoryRepo as any, productRepo as any);
  });

  describe('generateSlug', () => {
    it('correctly converts Vietnamese and special characters to slug', () => {
      expect(service.generateSlug('Thời trang nam & Nữ!')).toBe(
        'thoi-trang-nam-nu',
      );
      expect(service.generateSlug('Đồ gia dụng thông minh')).toBe(
        'do-gia-dung-thong-minh',
      );
      expect(service.generateSlug('  Áo Sơ Mi   Trắng--Đen  ')).toBe(
        'ao-so-mi-trang-den',
      );
    });
  });

  describe('getCategoryTree (AC-3)', () => {
    it('builds a hierarchical category tree and caches result', async () => {
      const mockCategories: Partial<CategoryEntity>[] = [
        {
          id: 'cat-1',
          name: 'Fashion',
          nameVi: 'Thời trang',
          slug: 'thoi-trang',
          level: 1,
          sortOrder: 1,
          isActive: true,
          parentId: null,
        },
        {
          id: 'cat-2',
          name: 'Áo nam',
          nameVi: null,
          slug: 'ao-nam',
          level: 2,
          sortOrder: 1,
          isActive: true,
          parentId: 'cat-1',
        },
        {
          id: 'cat-3',
          name: 'Áo sơ mi',
          slug: 'ao-so-mi',
          level: 3,
          sortOrder: 1,
          isActive: true,
          parentId: 'cat-2',
        },
        {
          id: 'cat-4',
          name: 'Electronics',
          nameVi: 'Điện tử',
          slug: 'dien-tu',
          level: 1,
          sortOrder: 2,
          isActive: true,
          parentId: null,
        },
      ];

      const qb: any = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(mockCategories),
      };
      categoryRepo.createQueryBuilder.mockReturnValue(qb);

      const tree = await service.getCategoryTree();

      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('cat-1');
      expect(tree[0].nameVi).toBe('Thời trang');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('cat-2');
      expect(tree[0].children[0].nameVi).toBeNull();
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe('cat-3');
      expect(tree[0].children[0].children[0].nameVi).toBeNull();
      expect(tree[1].id).toBe('cat-4');
      expect(tree[1].nameVi).toBe('Điện tử');

      // Second call should return cached data without querying queryBuilder again
      const cachedTree = await service.getCategoryTree();
      expect(cachedTree).toEqual(tree);
      expect(categoryRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });
  });

  describe('createCategory (AC-1)', () => {
    it('creates a root category with level 1 when parentId is omitted', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      const result = await service.createCategory({
        name: 'Watches',
        nameVi: '  Đồng hồ  ',
      });

      expect(result.level).toBe(1);
      expect(result.parentId).toBeNull();
      expect(result.slug).toBe('watches');
      expect(result.nameVi).toBe('Đồng hồ');
      expect(categoryRepo.save).toHaveBeenCalled();
    });

    it('normalizes blank nameVi to null on create', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      const result = await service.createCategory({
        name: 'Watches',
        nameVi: '   ',
      });

      expect(result.nameVi).toBeNull();
    });

    it('creates child category with level = parent.level + 1', async () => {
      categoryRepo.findOne
        .mockResolvedValueOnce({ id: 'parent-1', level: 1 } as CategoryEntity)
        .mockResolvedValueOnce(null);

      const result = await service.createCategory({
        name: 'Đồng hồ nam',
        parentId: 'parent-1',
      });

      expect(result.level).toBe(2);
      expect(result.parentId).toBe('parent-1');
      expect(result.slug).toBe('dong-ho-nam');
    });

    it('rejects creation if parent category does not exist', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createCategory({
          name: 'Đồng hồ nam',
          parentId: 'non-existing-id',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects creation if level would exceed 3 (AC-1: Max 3 levels)', async () => {
      categoryRepo.findOne.mockResolvedValue({
        id: 'parent-3',
        level: 3,
      } as CategoryEntity);

      await expect(
        service.createCategory({
          name: 'Danh mục cấp 4',
          parentId: 'parent-3',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCategory', () => {
    it('updates and clears nameVi properly', async () => {
      categoryRepo.findOne.mockResolvedValueOnce({
        id: 'cat-1',
        name: 'Electronics',
        nameVi: null,
        slug: 'electronics',
        level: 1,
        parentId: null,
      } as CategoryEntity);

      const updated = await service.updateCategory('cat-1', {
        nameVi: '  Điện tử  ',
      });
      expect(updated.nameVi).toBe('Điện tử');

      categoryRepo.findOne.mockResolvedValueOnce({
        id: 'cat-1',
        name: 'Electronics',
        nameVi: 'Điện tử',
        slug: 'electronics',
        level: 1,
        parentId: null,
      } as CategoryEntity);

      const cleared = await service.updateCategory('cat-1', {
        nameVi: '   ',
      });
      expect(cleared.nameVi).toBeNull();
    });

    it('rejects if setting parentId to itself', async () => {
      categoryRepo.findOne.mockResolvedValue({
        id: 'cat-1',
        level: 1,
      } as CategoryEntity);

      await expect(
        service.updateCategory('cat-1', { parentId: 'cat-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if new parent causes subtree depth to exceed 3 levels', async () => {
      categoryRepo.findOne
        .mockResolvedValueOnce({
          id: 'cat-1',
          parentId: null,
          level: 1,
        } as CategoryEntity)
        .mockResolvedValueOnce({
          id: 'target-parent',
          level: 2,
        } as CategoryEntity);

      // cat-1 has a child cat-2, which has a child cat-3 (depth 2)
      // Moving to target-parent (level 2) would make cat-3 level 4!
      categoryRepo.find
        .mockResolvedValueOnce([{ id: 'cat-2', parentId: 'cat-1' }])
        .mockResolvedValueOnce([{ id: 'cat-3', parentId: 'cat-2' }])
        .mockResolvedValueOnce([]);

      await expect(
        service.updateCategory('cat-1', { parentId: 'target-parent' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteCategory (AC-2)', () => {
    it('prevents deletion and throws ConflictException if category contains products', async () => {
      categoryRepo.findOne.mockResolvedValue({
        id: 'cat-with-products',
      } as CategoryEntity);
      productRepo.count.mockResolvedValue(5);

      await expect(service.deleteCategory('cat-with-products')).rejects.toThrow(
        ConflictException,
      );

      expect(categoryRepo.softDelete).not.toHaveBeenCalled();
    });

    it('prevents deletion and throws ConflictException if category has sub-categories', async () => {
      categoryRepo.findOne.mockResolvedValue({
        id: 'cat-with-children',
      } as CategoryEntity);
      productRepo.count.mockResolvedValue(0);
      categoryRepo.count.mockResolvedValue(2);

      await expect(service.deleteCategory('cat-with-children')).rejects.toThrow(
        ConflictException,
      );

      expect(categoryRepo.softDelete).not.toHaveBeenCalled();
    });

    it('successfully soft-deletes category when no products and no children exist', async () => {
      categoryRepo.findOne.mockResolvedValue({
        id: 'clean-cat',
      } as CategoryEntity);
      productRepo.count.mockResolvedValue(0);
      categoryRepo.count.mockResolvedValue(0);

      const result = await service.deleteCategory('clean-cat');

      expect(result.success).toBe(true);
      expect(categoryRepo.softDelete).toHaveBeenCalledWith('clean-cat');
    });
  });
});
