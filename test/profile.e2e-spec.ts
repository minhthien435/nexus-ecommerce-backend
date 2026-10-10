import {
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import {
  CurrentProfileController,
  ProfileController,
} from '../src/modules/identity/users/profile/profile.controller.js';
import { ProfileService } from '../src/modules/identity/users/profile/profile.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const passwordHash = 'must-never-leak';
const profile = {
  id: userId,
  email: 'a@example.com',
  fullName: 'A',
  phone: '0912345678',
  avatarUrl: null,
  roles: ['CUSTOMER', 'SELLER'],
  trustLevel: 'STANDARD',
};

describe('Profile HTTP contract (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const profiles = {
    get: vi.fn(async () => ({ ...profile })),
    update: vi.fn(async (_id, input) => ({ ...profile, ...input })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'profile-test-secret' })],
      controllers: [CurrentProfileController, ProfileController],
      providers: [
        AccessTokenGuard,
        { provide: ProfileService, useValue: profiles },
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
    token = await module.get(JwtService).signAsync({ sub: userId });
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('requires a valid bearer token on both exact routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', 'Bearer invalid')
      .send({ fullName: 'B' })
      .expect(401);
    expect(profiles.get).not.toHaveBeenCalled();
    expect(profiles.update).not.toHaveBeenCalled();
  });

  it('gets the public profile without credential names or values', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual(profile);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
    expect(profiles.get).toHaveBeenCalledWith(userId);
  });

  it('patches only supplied valid fields and accepts nullable values', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: '  B  ', phone: null, avatarUrl: null })
      .expect(200);
    expect(response.body).toMatchObject({
      fullName: 'B',
      phone: null,
      avatarUrl: null,
    });
    expect(profiles.update).toHaveBeenCalledWith(userId, {
      fullName: 'B',
      phone: null,
      avatarUrl: null,
    });
  });

  it.each([
    {},
    { email: 'new@example.com' },
    { fullName: '   ' },
    { phone: '123' },
    { avatarUrl: 'not-a-url' },
  ])('rejects invalid patch %# without updating', async (body) => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(profiles.update).not.toHaveBeenCalled();
  });

  it('preserves service 404 semantics for absent or deleted users', async () => {
    profiles.get.mockRejectedValueOnce(new NotFoundException());
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns 409 when the database rejects a duplicate phone', async () => {
    profiles.update.mockRejectedValueOnce(new ConflictException());
    await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '0987654321' })
      .expect(409);
  });
});
