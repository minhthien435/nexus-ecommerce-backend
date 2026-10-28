import {
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminUserController } from '../src/modules/identity/admin/admin-user.controller.js';
import { AdminUserService } from '../src/modules/identity/admin/admin-user.service.js';
import { IdentityAdminUserController } from '../src/modules/identity/admin/identity-admin-user.controller.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PermissionsGuard } from '../src/modules/identity/rbac/guards/permissions.guard.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';

const secret = 'admin-user-test-secret';
const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const base = '/api/v1/identity/admin/users';

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
    setStatus: vi.fn(),
    changeRoles: vi.fn(),
    resetPassword: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [AdminUserController, IdentityAdminUserController],
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

  beforeEach(() => {
    vi.clearAllMocks();
    rbac.hasAnyRole.mockResolvedValue(true);
    rbac.hasAllPermissions.mockResolvedValue(true);
  });
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

  it('serves the sprint list route with transformed filters and stable defaults', async () => {
    const response = await request(app.getHttpServer())
      .get(base)
      .query({
        search: ' Hoang ',
        role: 'seller',
        status: 'LOCKED',
        page: 2,
        limit: 10,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.items).toEqual([]);
    expect(users.list).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'Hoang',
        role: 'SELLER',
        status: 'LOCKED',
        page: 2,
        limit: 10,
        sortBy: 'fullName',
        sortOrder: 'ASC',
      }),
    );
  });

  it.each([
    { page: 0 },
    { limit: 101 },
    { sortBy: 'passwordHash' },
    { status: 'BANNED' },
  ])('rejects invalid list query %j', async (query) => {
    await request(app.getHttpServer())
      .get(base)
      .query(query)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(users.list).not.toHaveBeenCalled();
  });

  it('requires USER.VIEW for detail and returns missing users as 404', async () => {
    users.getById.mockRejectedValueOnce(
      new NotFoundException('User not found'),
    );
    await request(app.getHttpServer())
      .get(`${base}/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, ['USER.VIEW']);
    expect(users.getById).toHaveBeenCalledWith(targetId);
  });

  it.each(['ACTIVE', 'LOCKED'])(
    'updates status to %s using USER.UPDATE',
    async (status) => {
      users.setStatus.mockResolvedValueOnce({ id: targetId, status });
      const response = await request(app.getHttpServer())
        .patch(`${base}/${targetId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status, reason: 'Policy review' })
        .expect(200);
      expect(response.body.status).toBe(status);
      expect(users.setStatus).toHaveBeenCalledWith(
        actorId,
        targetId,
        status,
        'Policy review',
      );
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
        'USER.UPDATE',
      ]);
    },
  );

  it.each([
    { status: 'BANNED' },
    { status: 'SUSPENDED' },
    { status: null },
    { status: 'LOCKED', reason: 12 },
  ])('rejects invalid status body %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`${base}/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(users.setStatus).not.toHaveBeenCalled();
  });

  it('preserves last-admin conflict responses', async () => {
    users.setStatus.mockRejectedValueOnce(
      new ConflictException('The last active administrator is protected'),
    );
    await request(app.getHttpServer())
      .patch(`${base}/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'LOCKED' })
      .expect(409);
  });

  it.each([
    {
      body: { assign: ['SELLER'] },
      permissions: ['USER.ROLE.ASSIGN'],
      assign: ['SELLER'],
      revoke: [],
    },
    {
      body: { revoke: ['SELLER'] },
      permissions: ['USER.ROLE.REVOKE'],
      assign: [],
      revoke: ['SELLER'],
    },
    {
      body: { assign: ['STAFF'], revoke: ['SELLER'] },
      permissions: ['USER.ROLE.ASSIGN', 'USER.ROLE.REVOKE'],
      assign: ['STAFF'],
      revoke: ['SELLER'],
    },
  ])(
    'checks exactly the privileges for role batch $body',
    async ({ body, permissions, assign, revoke }) => {
      users.changeRoles.mockResolvedValueOnce({
        id: targetId,
        roles: ['BUYER', ...assign],
      });
      await request(app.getHttpServer())
        .patch(`${base}/${targetId}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, permissions);
      expect(users.changeRoles).toHaveBeenCalledWith(
        actorId,
        targetId,
        assign,
        revoke,
      );
    },
  );

  it.each([
    {},
    { assign: [], revoke: [] },
    { assign: null },
    { revoke: null },
    { assign: 'SELLER' },
    { assign: ['SELLER', 'SELLER'] },
    { assign: ['SELLER'], revoke: ['SELLER'] },
    { assign: [123] },
    { assign: ['SELLER'], unexpected: true },
  ])('rejects invalid role batch %j without mutation', async (body) => {
    await request(app.getHttpServer())
      .patch(`${base}/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(users.changeRoles).not.toHaveBeenCalled();
  });

  it.each(['USER.ROLE.ASSIGN', 'USER.ROLE.REVOKE'])(
    'denies a mixed batch missing %s',
    async (missing) => {
      rbac.hasAllPermissions.mockImplementation(
        async (_id, privileges) => !privileges.includes(missing),
      );
      await request(app.getHttpServer())
        .patch(`${base}/${targetId}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ assign: ['STAFF'], revoke: ['SELLER'] })
        .expect(403);
      expect(users.changeRoles).not.toHaveBeenCalled();
    },
  );

  it('changes password with USER.CHANGE_PASSWORD and responds with no body', async () => {
    const response = await request(app.getHttpServer())
      .patch(`${base}/${targetId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'Changed123!' })
      .expect(204);
    expect(response.text).toBe('');
    expect(rbac.hasAllPermissions).toHaveBeenCalledWith(actorId, [
      'USER.CHANGE_PASSWORD',
    ]);
    expect(users.resetPassword).toHaveBeenCalledWith(
      actorId,
      targetId,
      'Changed123!',
    );
  });

  it('does not allow USER.UPDATE alone to change passwords', async () => {
    rbac.hasAllPermissions.mockImplementation(
      async (_id, privileges) => !privileges.includes('USER.CHANGE_PASSWORD'),
    );
    await request(app.getHttpServer())
      .patch(`${base}/${targetId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'Changed123!' })
      .expect(403);
    expect(users.resetPassword).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { newPassword: 'weak' },
    { newPassword: null },
    { newPassword: 'Changed123!', tokenVersion: 0 },
  ])('rejects invalid password body %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`${base}/${targetId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(users.resetPassword).not.toHaveBeenCalled();
  });

  it.each(['status', 'roles', 'password'])(
    'protects %s from unauthenticated and non-admin calls',
    async (operation) => {
      await request(app.getHttpServer())
        .patch(`${base}/${targetId}/${operation}`)
        .send({})
        .expect(401);
      rbac.hasAnyRole.mockResolvedValueOnce(false);
      await request(app.getHttpServer())
        .patch(`${base}/${targetId}/${operation}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(users.setStatus).not.toHaveBeenCalled();
      expect(users.changeRoles).not.toHaveBeenCalled();
      expect(users.resetPassword).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed UUIDs before invoking a mutation', async () => {
    await request(app.getHttpServer())
      .patch(`${base}/not-a-uuid/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'LOCKED' })
      .expect(400);
    expect(users.setStatus).not.toHaveBeenCalled();
  });

  it('keeps legacy detail, locking, role and soft-delete routes available', async () => {
    users.getById.mockResolvedValueOnce({
      id: targetId,
      status: 'ACTIVE',
      roles: ['BUYER'],
    });
    const legacy = `/api/v1/admin/users/${targetId}`;
    await request(app.getHttpServer())
      .get(legacy)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${legacy}/lock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(users.lock).toHaveBeenCalledWith(actorId, targetId);
    await request(app.getHttpServer())
      .patch(`${legacy}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(users.unlock).toHaveBeenCalledWith(actorId, targetId);
    await request(app.getHttpServer())
      .post(`${legacy}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleCode: 'SELLER' })
      .expect(201);
    expect(users.assignRole).toHaveBeenCalledWith(actorId, targetId, 'SELLER');
    await request(app.getHttpServer())
      .delete(`${legacy}/roles/seller`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(users.revokeRole).toHaveBeenCalledWith(actorId, targetId, 'SELLER');
    await request(app.getHttpServer())
      .delete(legacy)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(users.softDelete).toHaveBeenCalledWith(actorId, targetId);
  });
});
