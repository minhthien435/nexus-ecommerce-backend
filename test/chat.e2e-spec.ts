import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ChatController } from '../src/modules/chat/chat.controller.js';
import { ChatService } from '../src/modules/chat/chat.service.js';
import { AccessTokenGuard } from '../src/modules/identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../src/modules/identity/domain/user.entity.js';
import { RbacService } from '../src/modules/identity/rbac/rbac.service.js';
import { RolesGuard } from '../src/modules/identity/rbac/guards/roles.guard.js';

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = '33333333-3333-4333-8333-333333333333';
const shopId = '44444444-4444-4444-8444-444444444444';

describe('Chat REST API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const chat = {
    open: vi.fn(),
    list: vi.fn(),
    unread: vi.fn(),
    history: vi.fn(),
    send: vi.fn(),
    markRead: vi.fn(),
  };
  const rbac = { hasAnyRole: vi.fn() };
  beforeEach(async () => {
    vi.clearAllMocks();
    rbac.hasAnyRole.mockResolvedValue(true);
    chat.open.mockResolvedValue({ id: conversationId });
    chat.list.mockResolvedValue([]);
    chat.unread.mockResolvedValue({ total: 3 });
    chat.history.mockResolvedValue({ items: [], nextCursor: null });
    chat.send.mockResolvedValue({ message: { id: 'm1' }, duplicate: false });
    chat.markRead.mockResolvedValue({ updated: 1 });
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'chat-e2e-secret' })],
      controllers: [ChatController],
      providers: [
        AccessTokenGuard,
        RolesGuard,
        { provide: ChatService, useValue: chat },
        { provide: RbacService, useValue: rbac },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: vi.fn().mockResolvedValue({ id: userId, tokenVersion: 1 }),
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
      .signAsync({ sub: userId, tokenVersion: 1 });
  });
  afterEach(async () => app.close());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('uses /api/v1/chat and protects all endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/chat/conversations')
      .expect(401);
    await request(app.getHttpServer())
      .get('/chat/conversations')
      .set(auth())
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/chat/conversations')
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/chat/unread-summary')
      .set(auth())
      .expect(200)
      .expect({ total: 3 });
  });

  it('enforces BUYER initiation and derives actor identity', async () => {
    rbac.hasAnyRole.mockResolvedValueOnce(false);
    await request(app.getHttpServer())
      .post('/api/v1/chat/conversations')
      .set(auth())
      .send({ shopId })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/chat/conversations')
      .set(auth())
      .send({ shopId, productSlug: 'phone' })
      .expect(201);
    expect(chat.open).toHaveBeenCalledWith(userId, {
      shopId,
      productSlug: 'phone',
    });
  });

  it('validates send/history contracts and forwards only authenticated identity', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set(auth())
      .send({ clientMessageId: 'bad', type: 'TEXT', text: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set(auth())
      .send({
        clientMessageId: '55555555-5555-4555-8555-555555555555',
        type: 'TEXT',
        text: 'hello',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/chat/conversations/${conversationId}/messages?limit=30`)
      .set(auth())
      .expect(200);
    expect(chat.send).toHaveBeenCalledWith(
      userId,
      conversationId,
      expect.objectContaining({ text: 'hello' }),
    );
    expect(chat.history).toHaveBeenCalledWith(
      userId,
      conversationId,
      expect.objectContaining({ limit: 30 }),
    );
  });

  it('routes read reset under the versioned contract', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/chat/conversations/${conversationId}/read`)
      .set(auth())
      .expect(200);
    expect(chat.markRead).toHaveBeenCalledWith(userId, conversationId);
  });
});
