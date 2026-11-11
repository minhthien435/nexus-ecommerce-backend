const redis = vi.hoisted(() => ({
  status: 'wait',
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: class RedisMock {
    constructor() {
      return redis;
    }
  },
}));

import { ConfigService } from '@nestjs/config';
import type { AiConversationTurn } from '../contracts/ai-assistant.types.js';
import { AiSessionService } from './ai-session.service.js';

describe('AiSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'wait';
    redis.connect.mockImplementation(async () => {
      redis.status = 'ready';
    });
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);
  });

  it('persists up to 10 turns in Redis with 30m TTL and reads last 6 by default', async () => {
    const service = new AiSessionService(new ConfigService());
    const stored: AiConversationTurn[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      text: `turn-${i + 1}`,
      timestamp: 1000 + i,
    }));

    redis.get.mockResolvedValueOnce(JSON.stringify(stored));
    await service.appendTurns('sess-1', [
      { role: 'user', text: 'turn-9', timestamp: 2001 },
      { role: 'model', text: 'turn-10', timestamp: 2002 },
      { role: 'user', text: 'turn-11', timestamp: 2003 },
    ]);

    expect(redis.set).toHaveBeenCalledWith(
      'ai:session:v1:sess-1',
      expect.any(String),
      'EX',
      1800,
    );
    const savedPayload = JSON.parse(
      redis.set.mock.calls[0][1] as string,
    ) as AiConversationTurn[];
    expect(savedPayload).toHaveLength(10);
    expect(savedPayload[0].text).toBe('turn-2');
    expect(savedPayload[9].text).toBe('turn-11');

    redis.get.mockResolvedValueOnce(JSON.stringify(savedPayload));
    const recent = await service.getHistory('sess-1');
    expect(recent).toHaveLength(6);
    expect(recent[0].text).toBe('turn-6');
    expect(recent[5].text).toBe('turn-11');
  });

  it('falls back gracefully to in-memory storage and isolates sessions by ownerKey', async () => {
    redis.connect.mockRejectedValue(new Error('Redis offline'));
    const service = new AiSessionService(new ConfigService());

    await service.appendTurns(
      'shared-sess',
      [
        { role: 'user', text: 'Tìm áo thun', timestamp: 1 },
        { role: 'model', text: 'Có 3 mẫu áo thun', timestamp: 2 },
      ],
      'user:buyer-1',
    );

    const owner1History = await service.getHistory(
      'shared-sess',
      6,
      'user:buyer-1',
    );
    const owner2History = await service.getHistory(
      'shared-sess',
      6,
      'user:buyer-2',
    );
    expect(owner1History).toHaveLength(2);
    expect(owner2History).toEqual([]);

    await service.clearSession('shared-sess', 'user:buyer-1');
    await expect(
      service.getHistory('shared-sess', 6, 'user:buyer-1'),
    ).resolves.toEqual([]);
  });
});
