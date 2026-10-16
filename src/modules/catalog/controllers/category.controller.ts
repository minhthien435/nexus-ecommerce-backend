import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CategoryService } from '../services/category.service.js';

@Controller('api/v1/catalog/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  async getCategoryTree() {
    return this.categoryService.getCategoryTree();
  }

  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.categoryService.getBySlug(slug);
  }

  @Get(':id')
  async getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.categoryService.getById(id);
  }
}
