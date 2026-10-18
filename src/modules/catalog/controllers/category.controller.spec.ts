import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoryController } from './admin-category.controller.js';
import { CategoryController } from './category.controller.js';

describe('Category Controllers', () => {
  let publicController: CategoryController;
  let adminController: AdminCategoryController;
  let categoryService: any;

  beforeEach(() => {
    categoryService = {
      getCategoryTree: vi
        .fn()
        .mockResolvedValue([{ id: 'cat-1', name: 'Electronics' }]),
      getById: vi.fn().mockResolvedValue({ id: 'cat-1', name: 'Electronics' }),
      getBySlug: vi
        .fn()
        .mockResolvedValue({ id: 'cat-1', slug: 'electronics' }),
      createCategory: vi
        .fn()
        .mockResolvedValue({ id: 'cat-new', name: 'Fashion' }),
      updateCategory: vi
        .fn()
        .mockResolvedValue({ id: 'cat-1', name: 'Electronics Updated' }),
      deleteCategory: vi
        .fn()
        .mockResolvedValue({ success: true, message: 'Deleted' }),
    };

    publicController = new CategoryController(categoryService);
    adminController = new AdminCategoryController(categoryService);
  });

  describe('CategoryController (Public)', () => {
    it('returns category tree', async () => {
      const tree = await publicController.getCategoryTree();
      expect(tree).toHaveLength(1);
      expect(categoryService.getCategoryTree).toHaveBeenCalled();
    });

    it('returns category by id', async () => {
      const result = await publicController.getById(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(result.id).toBe('cat-1');
      expect(categoryService.getById).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
      );
    });

    it('returns category by slug', async () => {
      const result = await publicController.getBySlug('electronics');
      expect(result.slug).toBe('electronics');
      expect(categoryService.getBySlug).toHaveBeenCalledWith('electronics');
    });
  });

  describe('AdminCategoryController (Admin)', () => {
    it('creates category with DTO', async () => {
      const dto = { name: 'Fashion' };
      const result = await adminController.create(dto);
      expect(result.name).toBe('Fashion');
      expect(categoryService.createCategory).toHaveBeenCalledWith(dto);
    });

    it('updates category', async () => {
      const dto = { name: 'Electronics Updated' };
      const result = await adminController.update(
        '00000000-0000-0000-0000-000000000001',
        dto,
      );
      expect(result.name).toBe('Electronics Updated');
      expect(categoryService.updateCategory).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
        dto,
      );
    });

    it('deletes category', async () => {
      const result = await adminController.delete(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(result.success).toBe(true);
      expect(categoryService.deleteCategory).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
      );
    });
  });
});
