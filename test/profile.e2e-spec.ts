import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { ProfileController } from '../src/modules/identity/users/profile/profile.controller.js';
import { ProfileService } from '../src/modules/identity/users/profile/profile.service.js';

const secret = 'profile-test-secret';
const userId = '11111111-1111-4111-8111-111111111111';
const publicProfile = {
  id: userId,
  email: 'user@example.com',
  fullName: 'User',
  phone: null,
  avatarUrl: null,
  roles: ['CUSTOMER'],
  trustLevel: 'STANDARD',
};

describe('Profile API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const profiles = {
    getProfile: vi.fn().mockResolvedValue(publicProfile),
    updateProfile: vi.fn().mockImplementation(async (_id, input) => ({
      ...publicProfile,
      ...input,
    })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [ProfileController],
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

  it('requires a valid, strictly formatted Bearer token on both routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token} extra`)
      .send({ fullName: 'Other' })
      .expect(401);
  });

  it('gets the current public profile without credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual(publicProfile);
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash/i);
    expect(profiles.getProfile).toHaveBeenCalledWith(userId);
  });

  it('patches nullable fields and rejects empty, unknown, and invalid payloads', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: null, avatarUrl: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.phone).toBeNull();
        expect(body.avatarUrl).toBeNull();
      });
    expect(profiles.updateProfile).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ phone: null, avatarUrl: null }),
    );

    for (const payload of [
      {},
      { email: 'other@example.com' },
      { fullName: null },
      { fullName: ' ' },
      { phone: '123' },
      { avatarUrl: 'not-a-url' },
    ]) {
      await request(app.getHttpServer())
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400);
    }
    expect(profiles.updateProfile).toHaveBeenCalledTimes(1);
  });
});
