import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminUserController } from '../src/modules/identity/admin/admin-user.controller.js';
import { AdminUserService } from '../src/modules/identity/admin/admin-user.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const secret = 'admin-user-test-secret';
const actorId = '11111111-1111-4111-8111-111111111111';

describe('Admin User API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const rbac = {
    hasAnyRole: vi.fn().mockResolvedValue(true),
    hasAllPermissions: vi.fn().mockResolvedValue(true),
  };
  const users = {
    list: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    }),
    getById: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    assignRole: vi.fn(),
    revokeRole: vi.fn(),
    softDelete: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [AdminUserController],
      providers: [
        AccessTokenGuard,
        RolesGuard,
        PermissionsGuard,
        { provide: RbacService, useValue: rbac },
        { provide: AdminUserService, useValue: users },
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
    await app.init();
    token = await module
      .get(JwtService)
      .signAsync({ sub: actorId, tokenVersion: 1 });
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('returns 401 without a valid access token', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
  });

  it('returns 403 when the authenticated user lacks ADMIN', async () => {
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows ADMIN with USER.LIST and applies pagination defaults', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, ['USER.LIST']);
    expect(users.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });
});
