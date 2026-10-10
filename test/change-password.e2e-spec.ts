import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { PasswordController } from '../src/modules/identity/users/password/password.controller.js';
import { PasswordService } from '../src/modules/identity/users/password/password.service.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('Change password API (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let token: string;
  const users = { findOne: vi.fn() };
  const passwords = { changePassword: vi.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'change-password-secret' })],
      controllers: [PasswordController],
      providers: [
        AccessTokenGuard,
        { provide: PasswordService, useValue: passwords },
        { provide: getRepositoryToken(UserEntity), useValue: users },
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
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: id, tokenVersion: 4 });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    users.findOne.mockResolvedValue({ id, tokenVersion: 4 });
    passwords.changePassword.mockResolvedValue(undefined);
  });
  afterAll(async () => app.close());

  it('returns the exact success response and obtains user id from the token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' })
      .expect(200)
      .expect({
        message: 'Password changed successfully. Please sign in again',
      });
    expect(passwords.changePassword).toHaveBeenCalledWith(id, {
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2!',
    });
  });

  it.each([
    {},
    { currentPassword: 'OldPassword1!' },
    { currentPassword: 1, newPassword: 'NewPassword2!' },
    { currentPassword: 'OldPassword1!', newPassword: 'weak' },
    {
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2!',
      userId: id,
    },
  ])(
    'rejects invalid or unknown payloads before the service %#',
    async (body) => {
      await request(app.getHttpServer())
        .post('/api/v1/users/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(passwords.changePassword).not.toHaveBeenCalled();
    },
  );

  it('rejects missing, invalid, legacy, stale, and absent-user tokens', async () => {
    const expired = await jwt.signAsync(
      { sub: id, tokenVersion: 4 },
      { expiresIn: -1 },
    );
    const legacy = await jwt.signAsync({ sub: id });
    const stale = await jwt.signAsync({ sub: id, tokenVersion: 3 });
    for (const authorization of [
      undefined,
      'Bearer invalid',
      `Bearer ${expired}`,
      `Bearer ${legacy}`,
      `Bearer ${stale}`,
    ]) {
      const call = request(app.getHttpServer())
        .post('/api/v1/users/change-password')
        .send({
          currentPassword: 'OldPassword1!',
          newPassword: 'NewPassword2!',
        });
      if (authorization) call.set('Authorization', authorization);
      await call.expect(401);
    }
    users.findOne.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/api/v1/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'OldPassword1!', newPassword: 'NewPassword2!' })
      .expect(401);
    expect(passwords.changePassword).not.toHaveBeenCalled();
  });
});
