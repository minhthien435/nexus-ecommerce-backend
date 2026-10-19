import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { AdminCategoryController } from '../src/modules/catalog/controllers/admin-category.controller.js';
import { CategoryController } from '../src/modules/catalog/controllers/category.controller.js';
import { CategoryEntity } from '../src/modules/catalog/domain/entities/category.entity.js';
import { ProductEntity } from '../src/modules/catalog/domain/entities/product.entity.js';
import { CategoryService } from '../src/modules/catalog/services/category.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';

describe('Admin category listing (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let categories: CategoryEntity[];
  const rbac = {
    hasAnyRole: vi.fn(),
    hasAllPermissions: vi.fn(),
  };

  beforeEach(async () => {
    rbac.hasAnyRole.mockReset().mockResolvedValue(true);
    rbac.hasAllPermissions.mockReset().mockResolvedValue(true);
    categories = [
      {
        id: categoryId,
        name: 'Phones',
        slug: 'phones',
        level: 1,
        sortOrder: 0,
        parentId: null,
        isActive: true,
        deletedAt: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Apple',
        slug: 'apple',
        level: 2,
        sortOrder: 0,
        parentId: categoryId,
        isActive: false,
        deletedAt: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Deleted',
        slug: 'deleted',
        level: 1,
        sortOrder: 1,
        parentId: null,
        isActive: false,
        deletedAt: new Date(),
      },
    ] as CategoryEntity[];
    const categoryRepo = {
      createQueryBuilder: () => {
        let activeOnly = false;
        const query = {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          addOrderBy: vi.fn().mockReturnThis(),
          andWhere: () => {
            activeOnly = true;
            return query;
          },
          getMany: async () =>
            categories.filter(
              (category) =>
                !category.deletedAt && (!activeOnly || category.isActive),
            ),
        };
        return query;
      },
      findOne: async ({ where }: { where: { id: string } }) =>
        categories.find(
          (category) => category.id === where.id && !category.deletedAt,
        ),
      save: async (category: CategoryEntity) => category,
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'admin-category-test-secret' })],
      controllers: [AdminCategoryController, CategoryController],
      providers: [
        CategoryService,
        AccessTokenGuard,
        { provide: RbacService, useValue: rbac },
        { provide: getRepositoryToken(CategoryEntity), useValue: categoryRepo },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: vi
              .fn()
              .mockResolvedValue({ id: actorId, tokenVersion: 1 }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: actorId, tokenVersion: 1 });
  });

  afterEach(async () => app.close());

  it('includes inactive children for admin without leaking them into the public cache', async () => {
    const publicList = () =>
      request(app.getHttpServer()).get('/api/v1/catalog/categories');
    const before = await publicList().expect(200);
    expect(before.body.data[0].children).toEqual([]);
    const admin = await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(admin.body.data).toHaveLength(1);
    expect(admin.body.data[0].children).toMatchObject([
      { slug: 'apple', isActive: false },
    ]);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'CATEGORY.LIST',
    ]);
    const after = await publicList().expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('keeps a disabled category visible for admin and allows enabling it again', async () => {
    for (const isActive of [false, true]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/categories/${categoryId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isActive })
        .expect(200);
      const admin = await request(app.getHttpServer())
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(admin.body.data[0].isActive).toBe(isActive);
      const publicResult = await request(app.getHttpServer())
        .get('/api/v1/catalog/categories')
        .expect(200);
      expect(
        publicResult.body.data.some(
          (category: { id: string }) => category.id === categoryId,
        ),
      ).toBe(isActive);
    }
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .expect(401);
  });

  it('requires ADMIN role', async () => {
    rbac.hasAnyRole.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('requires CATEGORY.LIST permission', async () => {
    rbac.hasAllPermissions.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
