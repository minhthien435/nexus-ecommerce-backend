import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppController } from './../src/app.controller.js';
import { AppService } from './../src/app.service.js';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

const redis = vi.hoisted(() => ({
  connect: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor() {
      return redis;
    }
  },
}));

describe('AppController (e2e)', () => {
  let app: INestApplication;
  const query = vi.fn();

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([{ result: 1 }]);
    redis.connect.mockReset().mockResolvedValue(undefined);
    redis.ping.mockReset().mockResolvedValue('PONG');
    redis.disconnect.mockClear();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        ConfigService,
        { provide: DataSource, useValue: { query } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it.each([
    [true, true, 200, 'ok'],
    [true, false, 200, 'degraded'],
    [false, true, 503, 'down'],
    [false, false, 503, 'down'],
  ] as const)(
    'reports database=%s redis=%s with HTTP %i',
    async (dbUp, redisUp, code, status) => {
      if (!dbUp) query.mockRejectedValue(new Error('DB unavailable'));
      if (!redisUp)
        redis.connect.mockRejectedValue(new Error('Redis unavailable'));
      const result = await request(app.getHttpServer())
        .get('/health')
        .expect(code);
      expect(result.body).toEqual({
        status,
        database: dbUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
        timestamp: expect.any(String),
      });
      expect(query).toHaveBeenCalledWith('SELECT 1');
      expect(redis.disconnect).toHaveBeenCalledOnce();
    },
  );

  afterEach(async () => {
    await app.close();
  });
});
