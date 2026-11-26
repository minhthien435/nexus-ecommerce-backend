import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCategoryController } from './admin-category.controller.js';
import { CategoryService } from '../services/category.service.js';
import { CreateCategoryDto } from '../dtos/create-category.dto.js';
import { UpdateCategoryDto } from '../dtos/update-category.dto.js';

describe('AdminCategoryController', () => {
  let controller: AdminCategoryController;
  let categoryService: CategoryService;

  beforeEach(() => {
    categoryService = {
      getCategoryTree: vi.fn(),
      createCategory: vi.fn(),
      updateCategory: vi.fn(),
      deleteCategory: vi.fn(),
    } as unknown as CategoryService;
    controller = new AdminCategoryController(categoryService);
  });

  it('delegates getCategoryTree to CategoryService with includeInactive=true', async () => {
    const mockTree = [
      {
        id: 'cat-1',
        name: 'Electronics',
        nameVi: 'Điện tử',
        slug: 'electronics',
        level: 1,
        sortOrder: 0,
        isActive: false,
        parentId: null,
        children: [],
      },
    ];

    vi.mocked(categoryService.getCategoryTree).mockResolvedValue(mockTree);

    const result = await controller.getCategoryTree();

    expect(categoryService.getCategoryTree).toHaveBeenCalledWith(true);
    expect(result).toBe(mockTree);
  });

  it('delegates create to CategoryService with dto', async () => {
    const dto: CreateCategoryDto = {
      name: 'Smartphones',
      nameVi: 'Điện thoại thông minh',
      parentId: 'cat-1',
      sortOrder: 1,
      isActive: true,
    };
    const mockCreated = {
      id: 'cat-2',
      ...dto,
      slug: 'smartphones',
      level: 2,
    } as any;

    vi.mocked(categoryService.createCategory).mockResolvedValue(mockCreated);

    const result = await controller.create(dto);

    expect(categoryService.createCategory).toHaveBeenCalledWith(dto);
    expect(result).toBe(mockCreated);
  });

  it('delegates update to CategoryService with id and dto', async () => {
    const id = 'cat-2';
    const dto: UpdateCategoryDto = {
      name: 'Smartphones & Tablets',
      isActive: true,
    };
    const mockUpdated = {
      id,
      name: dto.name,
      isActive: true,
    } as any;

    vi.mocked(categoryService.updateCategory).mockResolvedValue(mockUpdated);

    const result = await controller.update(id, dto);

    expect(categoryService.updateCategory).toHaveBeenCalledWith(id, dto);
    expect(result).toBe(mockUpdated);
  });

  it('delegates delete to CategoryService with id', async () => {
    const id = 'cat-2';
    const mockDeleteResult = {
      success: true,
      message: 'Xóa danh mục thành công',
    };

    vi.mocked(categoryService.deleteCategory).mockResolvedValue(
      mockDeleteResult,
    );

    const result = await controller.delete(id);

    expect(categoryService.deleteCategory).toHaveBeenCalledWith(id);
    expect(result).toEqual(mockDeleteResult);
  });
});
